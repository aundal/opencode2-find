# opencode2-find

Full-text search across every OpenCode session, driven from a single `/find` command in
the TUI. Built for OpenCode 2.x, where `opencode db` no longer exists.

![opencode](https://img.shields.io/badge/opencode-2.x-blue)

## What it does

```
/find sqlite
```

returns a table of the sessions that mention `sqlite`, with the matching text bolded, the
latest user prompt of each session, and a ready-to-run `opencode -s <id>` command:

| Title | Latest prompt | Text | Session |
| --- | --- | --- | --- |
| Loginoplysninger til opencode2-serveren `2026-09-25 20:05` | Hvad hjælper rotation hvis jeg skal ligge dem i den fil alligvel? | ...Credentials flyttede fra `auth.json` ind i **SQLite** `credential`-tabellen... | `opencode -s ses_f264d3fc7ffen8g4cYlyxSNfdo` |

## Install

```powershell
# Windows
.\install.ps1
```

```bash
# macOS / Linux
./install.sh
```

Or copy the two files yourself:

```
command/find.md              -> ~/.config/opencode/commands/find.md
scripts/session-search.ts    -> ~/.config/opencode/scripts/session-search.ts
```

Requires [Bun](https://bun.sh) (`bun install -g bun` on Windows, `curl -fsSL https://bun.sh/install | bash`
elsewhere). OpenCode reloads command files automatically, so there is nothing to restart.

## Usage

In the TUI:

```
/find <term> [<term> ...]
```

- Multiple words are combined with AND — every word must appear in the same hit.
- Quote a phrase to require that exact wording: `/find "hænger på windows"`.
- Matching is case-insensitive and word-bounded: `allan` does not match `allanchor`
  or `originalLanguage`, while `java` matches both the word *java* and `Main.java`.
- User text, assistant text, shell commands and tool output are all searched.

From a shell, the script works standalone:

```bash
bun scripts/session-search.ts "sqlite" --limit 10
```

| Flag          | Default | Description                                                    |
| ------------- | ------- | -------------------------------------------------------------- |
| `--limit N`   | `15`    | Maximum number of sessions in the result                        |
| `--minutes N` | `0`     | Drop sessions with a user prompt from the last N minutes        |
| `--exclude`   | —       | Drop one specific session id                                    |
| `--cwd PATH`  | all     | Only sessions started in this directory                         |
| `--json`      | off     | Raw JSON instead of a markdown table                            |

Every session is searched by default, including the one you are typing in. Use
`--minutes 30` to skip conversations you have been working in recently, or
`--exclude <id>` to drop a single session.

`OPENCODE_DB` overrides the database path. The default is
`~/.local/share/opencode/opencode.db`.

## How it works

The script opens OpenCode's own SQLite database **read-only** with `bun:sqlite` and
searches both storage generations, because a 2.x install keeps the pre-migration
sessions around:

| Generation | Sessions | Messages |
| ---------- | -------- | -------- |
| v2         | `session_v2` | `session_message` |
| legacy     | `session`    | `message` + `part` |

Notes on the implementation:

- SQL does the coarse filtering (`data LIKE '%word%'`, ~1–2 s over a multi-GB database),
  and the exact word-bounded match runs in JavaScript on the rows that survive. JSON is
  parsed only for those rows, and message bodies are fetched in batches of 100 so a
  2.7 GB database never has to fit in memory. `json_extract` inside a `WHERE` clause is
  avoided on purpose — it parses every row and is ~10x slower.
- v2 stores the user prompt in `session_message.data.text`, while assistant and
  synthetic messages carry `data.content[]` parts. Both are handled.
- Each session keeps only its best hit: a title match beats message text, which beats
  tool output, which beats shell commands.
- The active session is **not** skipped by default — the search covers everything.
  When you want that, pass `--minutes 30` to drop every session you have typed in
  recently. OpenCode does not expose the current session id to tools, so identifying
  it needs a guess: the session with the newest non-empty user prompt. `OPENCODE_SESSION_ID`
  or `--exclude <id>` sets it explicitly.

## Files

| File                      | Purpose                                             |
| ------------------------- | --------------------------------------------------- |
| `command/find.md`         | The `/find` command that calls the script            |
| `scripts/session-search.ts` | Read-only session search over `opencode.db`        |

## License

MIT
