#!/usr/bin/env bash
# Private live test of label scanning on your own machine (docs/live-testing.md).
# Reads MINIMAX_API_KEY from .env.local (never printed), builds with scanning on and serves the app.
#   scripts/live-test.sh          http://localhost:3000, this computer only
#   scripts/live-test.sh --lan    also reachable from your phone on the same Wi-Fi (anyone on that
#                                 network could then use your MiniMax quota while it runs)
#   scripts/live-test.sh --check  first sends one test image to MiniMax (pnpm verify:minimax)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-3000}
HOST=127.0.0.1
CHECK=0
for arg in "$@"; do
  case "$arg" in
    --lan) HOST=0.0.0.0 ;;
    --check) CHECK=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [ -f .env.local ] && grep -Eq '^MINIMAX_API_KEY=.+' .env.local; then
  echo "AI: MiniMax key found in .env.local (not shown)."
else
  echo "AI: no MINIMAX_API_KEY in .env.local, so scanning runs in Manual mode (you type the label)."
  echo "    Add a line MINIMAX_API_KEY=<your key> to .env.local to test AI reading."
fi

pnpm install --frozen-lockfile
[ "$CHECK" = 1 ] && pnpm verify:minimax
NEXT_PUBLIC_KEEPLY_SCAN=1 pnpm build
# This private run has no Supabase invites, so AI access is open to whoever reaches this server.
export KEEPLY_SCAN_ACCESS=open

echo
echo "Open http://localhost:$PORT/appliances/scan"
if [ "$HOST" = 0.0.0.0 ]; then
  IP=$( (ipconfig getifaddr en0 || ipconfig getifaddr en1 || hostname -I | awk '{print $1}') 2>/dev/null || true)
  [ -n "$IP" ] && echo "On your phone (same Wi-Fi): http://$IP:$PORT/appliances/scan"
fi
echo "Stop with Ctrl+C."
exec pnpm exec next start -H "$HOST" -p "$PORT"
