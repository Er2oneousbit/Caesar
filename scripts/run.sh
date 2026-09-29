#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# run.sh - launch Colonia on Linux / macOS.
#
# Usage:
#   scripts/run.sh            open dist/colonia.html (builds it if missing)
#   scripts/run.sh --dev      start the dev server and open http://localhost:8080/
#   scripts/run.sh --build    force a rebuild, then open the built game
#   scripts/run.sh --port N   dev server port (default 8080)
#   scripts/run.sh --flags "debug=1&seed=42"   extra URL options
#   scripts/run.sh --help
#
# Made with ❤️ from your friendly hacker - er2oneousbit
# -----------------------------------------------------------------------------
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$ROOT/dist/colonia.html"
MODE="play"
PORT=8080
FLAGS=""
FORCE_BUILD=0

usage() { sed -n '3,13p' "$0" | sed 's/^# \{0,1\}//'; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev) MODE="dev" ;;
    --build) FORCE_BUILD=1 ;;
    --port) PORT="${2:?--port needs a value}"; shift ;;
    --flags) FLAGS="${2:?--flags needs a value}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

open_url() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 &
  elif command -v open >/dev/null 2>&1; then open "$1"
  else echo "Open this in your browser: $1"; fi
}

need_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "Node.js 18+ is required (https://nodejs.org/)." >&2
    exit 1
  fi
  local major
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if (( major < 18 )); then echo "Node $(node --version) is too old; need 18+." >&2; exit 1; fi
}

build() {
  need_node
  cd "$ROOT"
  [[ -d node_modules/esbuild ]] || npm install --no-audit --no-fund
  node scripts/build.mjs
}

if [[ "$MODE" == "dev" ]]; then
  need_node
  URL="http://localhost:$PORT/${FLAGS:+?$FLAGS}"
  echo "Dev server: $URL  (Ctrl+C to stop)"
  (sleep 1 && open_url "$URL") &
  cd "$ROOT" && exec node scripts/serve.mjs --port "$PORT"
else
  if [[ $FORCE_BUILD -eq 1 || ! -f "$DIST" ]]; then build; fi
  URL="file://$DIST${FLAGS:+?$FLAGS}"
  echo "Opening $URL"
  open_url "$URL"
fi
