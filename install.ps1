$ErrorActionPreference = "Stop"

$root = Join-Path $env:USERPROFILE ".config\opencode"
New-Item -ItemType Directory -Force -Path (Join-Path $root "commands") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $root "scripts") | Out-Null

Copy-Item "command\find.md" (Join-Path $root "commands\find.md") -Force
Copy-Item "scripts\session-search.ts" (Join-Path $root "scripts\session-search.ts") -Force

if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Warning "Bun was not found. Install it with: bun install -g bun"
}

Write-Host "Installed /find:"
Write-Host "  $root\commands\find.md"
Write-Host "  $root\scripts\session-search.ts"
Write-Host "Run /find <term> in OpenCode."
