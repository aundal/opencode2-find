#!/usr/bin/env bash
set -euo pipefail

root="$HOME/.config/opencode"
mkdir -p "$root/commands" "$root/scripts"

cp command/find.md "$root/commands/find.md"
cp scripts/session-search.ts "$root/scripts/session-search.ts"

if ! command -v bun >/dev/null 2>&1; then
  echo "Warning: bun was not found. Install it with: curl -fsSL https://bun.sh/install | bash" >&2
fi

echo "Installed /find:"
echo "  $root/commands/find.md"
echo "  $root/scripts/session-search.ts"
echo "Run /find <term> in OpenCode."
