---
description: Søg i alle opencode-sessioner efter et topic og vis resultatet som tabel
---

Søger efter sessioner med: $ARGUMENTS

Kør søgningen og vis resultatet:

```powershell
bun run "$HOME/.config/opencode/scripts/session-search.ts" '<SØGEORD>'
```

Regler for søgningen:
1. Sæt alle ord fra `$ARGUMENTS` ind i den samme kommando. Flere ord = alle ord skal være i samme fund (OG-logik). Sæt flere ord i anførselstegn, når rækkefølgen er vigtig: `"hænger på windows"`.
2. Escape `'` i søgeordene som `''`, så PowerShell ikke bryder strengen.
3. Ordet matcher kun som selvstændigt ord, så `allan` ikke matcher `allanchor` eller `originalLanguage`. Til gengæld matcher `java` både ordet *java* og filer som `Main.java` — der skal altså ikke bruges et særskilt mønster-map for filendelser.
4. Søgningen dækker alle sessioner, også den igangværende. Tilføj `--minutes 30` kun hvis brugeren beder om at springe nylige sessioner over.
5. Søgningen dækker både tekst fra dig, fra modellen, kommandoer og værktøjsoutput.
6. Tømme søgeord eller kun almindelige ord: kør igen med ét konkret ord, f.eks. en kommando, et filnavn eller en fejltekst.

Output er allerede en færdig tabel med titel, seneste prompt, tekst-snippet med fed skrift omkring fundet, og `opencode -s <id>`.

Vis præcis det scriptet skriver, plus antallet fund. Ingen forklaring, ingen ekstra analyse.

Hvis der ikke findes noget, svar kun:
Ingen sessioner fundet for "$ARGUMENTS".
