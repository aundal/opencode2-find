#!/usr/bin/env bun
// Session-søgning i opencodes egen SQLite-database (v2.0.6).
// Læser BÅde v2-tabellerne (session_v2/session_message) og legacy-tabellerne (session/message/part).
// Brug:  bun scripts/session-search.ts "<query>" [--limit N] [--exclude ses_x] [--cwd C:\path] [--json]
// Output: antal + markdown-tabel (eller JSON med --json).
import { Database } from "bun:sqlite"
import os from "node:os"
import path from "node:path"

const DB_PATH =
  process.env.OPENCODE_DB ?? path.join(os.homedir(), ".local", "share", "opencode", "opencode.db")

type Hit = {
  id: string
  title: string
  directory: string
  time_updated: number
  hitTime: number
  source: string
  snippet: string
  score: number
}

const argv = process.argv.slice(2)
const flags = new Set(["--json", "--help", "-h"])
let limit = 15
let exclude: string | undefined
let cwd: string | undefined
let minutes = 0
let expectValue = false
const positional: string[] = []
for (const a of argv) {
  if (a === "--limit") {
    expectValue = "limit"
    continue
  }
  if (a === "--exclude") {
    expectValue = "exclude"
    continue
  }
  if (a === "--cwd") {
    expectValue = "cwd"
    continue
  }
  if (a === "--minutes") {
    expectValue = "minutes"
    continue
  }
  if (flags.has(a)) continue
  if (expectValue) {
    if (expectValue === "limit") limit = Number(a) || limit
    if (expectValue === "exclude") exclude = a
    if (expectValue === "cwd") cwd = a
    if (expectValue === "minutes") minutes = Number(a) || 0
    expectValue = false
    continue
  }
  positional.push(a)
}

if (argv.includes("--help") || argv.includes("-h")) {
  console.log(
    'Brug: bun scripts/session-search.ts "<query>" [--limit N] [--exclude ses_x] [--minutes N] [--cwd C:\\path] [--json]',
  )
  process.exit(0)
}

const rawQuery = positional.join(" ").trim()
if (!rawQuery) {
  console.log('Brug: bun scripts/session-search.ts "<query>" [--limit N] [--json]')
  process.exit(1)
}

/** Sådan udledes mønstre: ord-grænser på yderste tegn, så "allan" ikke matcher "allanchor". */
function terms(query: string): string[] {
  const out: string[] = []
  const re = /"([^"]+)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(query))) out.push((m[1] ?? m[2]).trim())
  return out.filter(Boolean)
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function pattern(term: string) {
  const body = escapeRe(term)
  const head = /^[\p{L}\p{N}_]/u.test(term) ? "(?<![\\p{L}\\p{N}_])" : ""
  const tail = /[\p{L}\p{N}_]$/u.test(term) ? "(?![\\p{L}\\p{N}_])" : ""
  return new RegExp(head + body + tail, "giu")
}

const wordList = terms(rawQuery)
if (wordList.length === 0) {
  console.log("Tom forespørgsel.")
  process.exit(1)
}
const regexes = wordList.map(pattern)
// SQL kan ikke matche med ord-grænser, så grovsøges på det længste enkeltord og
// den præcise filtrering sker i JS.
const prefilter = wordList
  .flatMap((t) => t.split(/\s+/))
  .sort((a, b) => b.length - a.length)[0]
const like = `%${prefilter.replace(/[%_]/g, "")}%`

function matches(text: string) {
  return regexes.every((r) => {
    r.lastIndex = 0
    return r.test(text)
  })
}

function ranges(text: string): [number, number][] {
  const out: [number, number][] = []
  for (const r of regexes) {
    r.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = r.exec(text))) {
      out.push([m.index, m.index + m[0].length])
      if (out.length > 50) break
      if (m[0].length === 0) r.lastIndex++
    }
  }
  return out.sort((a, b) => a[0] - b[0])
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim()
const cell = (s: string) => s.replace(/\|/g, "\\|")

function snippet(text: string, before = 55, after = 55): string {
  const flat = collapse(text)
  const rs = ranges(flat)
  if (rs.length === 0) return cell(flat.slice(0, before + after))
  const [start] = rs[0]
  const from = Math.max(0, start - before)
  const to = Math.min(flat.length, start + before + after)
  let out = from > 0 ? "..." : ""
  let pos = from
  for (const [s, e] of rs) {
    if (e <= from || s >= to) continue
    const cs = Math.max(s, from)
    const ce = Math.min(e, to)
    out += cell(flat.slice(pos, cs)) + "**" + cell(flat.slice(cs, ce)) + "**"
    pos = ce
  }
  out += cell(flat.slice(pos, to))
  if (to < flat.length) out += "..."
  return out
}

if (!Bun.file(DB_PATH).exists()) {
  console.log(`Database ikke fundet: ${DB_PATH}`)
  process.exit(1)
}
const db = new Database(DB_PATH, { readonly: true })

/** En installation kan have kun v2-tabeller eller begge sæt (legacy bliver liggende efter migrering). */
const tables = new Set(
  (db.query(`SELECT name FROM sqlite_master WHERE type = 'table';`).all() as any[]).map((r) => r.name),
)
const has = (...names: string[]) => names.every((n) => tables.has(n))

function hasUserText(data: string) {
  try {
    const d = JSON.parse(data)
    if (typeof d.text === "string" && d.text.trim().length > 0) return true
    return (d.content ?? []).some((p: any) => p.type === "text" && (p.text ?? "").trim().length > 0)
  } catch {
    return false
  }
}

/**
 * Nuværende session kan ikke læses fra DB'en direkte, så den findes som den session
 * der har den seneste ikke-tomme brugerprompt. Synthetic/automatiske prompts er tomme
 * og springes over, så en baggrunds-ping ikke fortrænger den aktive samtale.
 */
function detectCurrent(): string | undefined {
  if (process.env.OPENCODE_SESSION_ID) return process.env.OPENCODE_SESSION_ID
  if (has("session_message"))
    for (const r of db
      .query(`SELECT session_id, data FROM session_message WHERE type = 'user' ORDER BY time_created DESC LIMIT 30;`)
      .all() as any[])
      if (hasUserText(r.data)) return r.session_id
  if (has("message"))
    for (const r of db
      .query(
        `SELECT session_id, data FROM message WHERE json_extract(data,'$.role') = 'user' ORDER BY time_created DESC LIMIT 30;`,
      )
      .all() as any[])
      if (hasUserText(r.data)) return r.session_id
  if (has("session_v2"))
    return (db.query(`SELECT id FROM session_v2 WHERE parent_id IS NULL ORDER BY time_updated DESC LIMIT 1;`).get() as any)
      ?.id
  return undefined
}

const currentSession = exclude ?? detectCurrent()

/** Sessioner der ikke skal med i resultatet: den aktive samtale + valgfrit alle med en prompt fra de sidste N minutter. */
const excluded = new Set<string>()
if (currentSession) excluded.add(currentSession)
if (minutes > 0 && has("session_message")) {
  const since = Date.now() - minutes * 60_000
  for (const r of db
    .query(
      `SELECT session_id, time_created FROM session_message WHERE type = 'user' AND time_created >= ? ORDER BY time_created DESC LIMIT 200;`,
    )
    .all(since) as any[])
    excluded.add(r.session_id)
}

const dirFilter = cwd ? cwd.replace(/[\\/]+$/, "").toLowerCase() : undefined
const keepDir = (d: string | null) => !dirFilter || (d ?? "").toLowerCase() === dirFilter

function sessionIndex() {
  const map = new Map<string, { id: string; title: string; directory: string; time_updated: number }>()
  const add = (s: any) => {
    if (map.has(s.id)) return
    map.set(s.id, {
      id: s.id,
      title: s.title ?? "Uden titel",
      directory: s.directory,
      time_updated: s.time_updated,
    })
  }
  if (has("session_v2"))
    for (const s of db.query(`SELECT id, title, directory, time_updated FROM session_v2 WHERE parent_id IS NULL;`).all() as any[])
      add(s)
  if (has("session"))
    for (const s of db.query(`SELECT id, title, directory, time_updated FROM session WHERE parent_id IS NULL;`).all() as any[])
      add(s)
  return map
}
const sessions = sessionIndex()

const hits: Hit[] = []

function push(
  s: { id: string; title: string; directory: string; time_updated: number } | undefined,
  text: string,
  hitTime: number,
  source: string,
  score: number,
) {
  if (!s || excluded.has(s.id) || !keepDir(s.directory)) return
  if (!matches(text)) return
  hits.push({
    id: s.id,
    title: s.title,
    directory: s.directory,
    time_updated: s.time_updated,
    hitTime,
    source,
    snippet: snippet(text),
    score,
  })
}

// 1) Titler
for (const s of sessions.values()) {
  if (excluded.has(s.id) || !keepDir(s.directory)) continue
  if (matches(s.title)) hits.push({ ...s, hitTime: s.time_updated, source: "titel", snippet: snippet(s.title), score: 0 })
}

const chunk = <T,>(arr: T[], size = 100): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
const MAX_INLINE = 400_000

// 2) Legacy-indhold (part). Rækkerne hentes kun med id/længde, og de store JSON-blobs
// hentes bagefter i bidder, så en 2,7 GB-database ikke skal ind i hukommelsen.
if (has("part", "message")) {
  const rows = db
    .query(
      `SELECT id, session_id, message_id, time_created, length(data) AS len
       FROM part WHERE data LIKE ? ORDER BY time_created DESC LIMIT 2000;`,
    )
    .all(like) as any[]
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const roles = new Map<string, string>()
  for (const group of chunk(rows)) {
    const msgIds = [...new Set(group.map((r) => r.message_id).filter(Boolean) as string[])]
    if (msgIds.length > 0) {
      const qs = msgIds.map(() => "?").join(",")
      for (const m of db
        .query(`SELECT id, json_extract(data,'$.role') AS role FROM message WHERE id IN (${qs});`)
        .all(...msgIds) as any[])
        roles.set(m.id, m.role ?? "?")
    }
    const partIds = group.filter((r) => r.len <= MAX_INLINE).map((r) => r.id)
    if (partIds.length === 0) continue
    const pqs = partIds.map(() => "?").join(",")
    for (const p of db.query(`SELECT id, data FROM part WHERE id IN (${pqs});`).all(...partIds) as any[]) {
      const row = rowById.get(p.id)
      if (!row) continue
      const s = sessions.get(row.session_id)
      if (!s || excluded.has(s.id)) continue
      let d: any
      try {
        d = JSON.parse(p.data)
      } catch {
        continue
      }
      const role = roles.get(row.message_id ?? "")
      const source = role === "user" ? "bruger" : role === "assistant" ? "assistent" : "værktøj"
      if (d.type === "text" && typeof d.text === "string") push(s, d.text, row.time_created, source, 1)
      else if (d.type === "tool") {
        const st = d.state ?? {}
        const out = st.metadata?.output ?? st.output ?? st.error
        if (typeof out === "string" && out.trim()) push(s, out, row.time_created, "værktøj", 2)
        if (typeof st.input?.command === "string") push(s, st.input.command, row.time_created, "kommando", 3)
      }
    }
  }
}

// 3) v2-indhold (session_message)
if (has("session_v2", "session_message")) {
  const rows = db
    .query(
      `SELECT id, session_id, type, time_created, length(data) AS len
       FROM session_message WHERE data LIKE ? ORDER BY time_created DESC LIMIT 2000;`,
    )
    .all(like) as any[]
  const rowById = new Map(rows.map((r) => [r.id, r]))
  for (const group of chunk(rows)) {
    const ids = group.filter((r) => r.len <= MAX_INLINE).map((r) => r.id)
    if (ids.length === 0) continue
    const qs = ids.map(() => "?").join(",")
    for (const m of db.query(`SELECT id, data FROM session_message WHERE id IN (${qs});`).all(...ids) as any[]) {
      const row = rowById.get(m.id)
      if (!row) continue
      const s = sessions.get(row.session_id)
      if (!s || excluded.has(s.id)) continue
      let d: any
      try {
        d = JSON.parse(m.data)
      } catch {
        continue
      }
      const source = row.type === "user" ? "bruger" : row.type === "assistant" ? "assistent" : row.type
      // v2 gemmer brugerens prompt i data.text, mens assistant/synthetic ligger i content[].
      if (typeof d.text === "string" && d.text.trim()) push(s, d.text, row.time_created, source, 1)
      for (const part of d.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") push(s, part.text, row.time_created, source, 1)
        else if (part.type === "tool") {
          const st = part.state ?? {}
          const out = typeof st.output === "string" ? st.output : st.content?.map((c: any) => c.text ?? "").join(" ")
          if (typeof out === "string" && out.trim()) push(s, out, row.time_created, "værktøj", 2)
          if (typeof st.input?.command === "string") push(s, st.input.command, row.time_created, "kommando", 3)
        }
      }
    }
  }
}

// 4) Én bedste hit pr. session: titel slår læsning fra dig/assistanten, som slår værktøj og kommandoer
const bySession = new Map<string, Hit>()
for (const h of hits.sort((a, b) => a.score - b.score || b.hitTime - a.hitTime)) {
  const cur = bySession.get(h.id)
  if (!cur || h.score < cur.score || (h.score === cur.score && h.hitTime > cur.hitTime)) bySession.set(h.id, h)
}
const best = [...bySession.values()]
  .sort((a, b) => a.score - b.score || b.time_updated - a.time_updated)
  .slice(0, limit)

function latestPrompt(id: string): string {
  if (has("session_v2", "session_message")) {
    const v2 = db
      .query(
        `SELECT data FROM session_message WHERE session_id = ? AND type = 'user'
         ORDER BY time_created DESC LIMIT 1;`,
      )
      .get(id) as any
    if (v2) {
      try {
        const d = JSON.parse(v2.data)
        const t = [
          typeof d.text === "string" ? d.text : "",
          ...(d.content ?? []).filter((p: any) => p.type === "text").map((p: any) => p.text),
        ].join(" ")
        if (collapse(t)) return cell(collapse(t).slice(0, 120))
      } catch {}
    }
  }
  if (has("message", "part")) {
    const m = db
      .query(
        `SELECT id FROM message WHERE session_id = ? AND json_extract(data,'$.role') = 'user'
         ORDER BY time_created DESC LIMIT 1;`,
      )
      .get(id) as any
    if (m) {
      const t = db
        .query(`SELECT data FROM part WHERE message_id = ? AND json_extract(data,'$.type') = 'text' LIMIT 20;`)
        .all(m.id) as any[]
      const joined = t
        .map((p) => {
          try {
            return JSON.parse(p.data).text ?? ""
          } catch {
            return ""
          }
        })
        .join(" ")
      if (collapse(joined)) return cell(collapse(joined).slice(0, 120))
    }
  }
  return ""
}

const fmt = (ms: number) =>
  new Date(ms).toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" })

if (argv.includes("--json")) {
  console.log(
    JSON.stringify(
      best.map((h) => ({ ...h, time_updated_iso: fmt(h.time_updated), prompt: latestPrompt(h.id) })),
      null,
      2,
    ),
  )
} else if (best.length === 0) {
  console.log(`Ingen sessioner fundet for "${rawQuery}".`)
} else {
  const rows = best.map(
    (h) =>
      `| ${cell(h.title)} \`${fmt(h.time_updated)}\` | ${latestPrompt(h.id) || "—"} | ${h.snippet} | \`opencode -s ${h.id}\` |`,
  )
  console.log(`Fundet i ${best.length} session(er)\n`)
  console.log(`| Titel | Seneste prompt | Tekst | Session |\n| --- | --- | --- | --- |`)
  console.log(rows.join("\n"))
}
db.close()
