#!/bin/sh
# The entrypoint selects the process (spec 07 section 11.1).
set -e
cmd="$1"
[ $# -gt 0 ] && shift
case "$cmd" in
  api)     exec pnpm exec tsx packages/api/src/main.ts "$@" ;;
  rt)      exec pnpm exec tsx packages/rt/src/main.ts "$@" ;;
  mcp)     exec pnpm exec tsx packages/mcp/src/main.ts "$@" ;;
  migrate) exec pnpm exec tsx packages/api/src/migrate-main.ts "$@" ;;
  reset)   exec pnpm exec tsx packages/api/src/reset-main.ts "$@" ;;
  gen)     exec pnpm exec tsx packages/gen/src/main.ts "$@" ;;
  seed)    pnpm exec tsx packages/api/src/reset-main.ts && exec pnpm exec tsx packages/gen/src/main.ts ;;
  web)     exec pnpm --filter @plinth/web exec vite --host 0.0.0.0 --port 5173 ;;
  worker|ingest|driver) echo "$cmd is not part of L1"; exit 64 ;;
  *) echo "usage: entrypoint.sh api|rt|mcp|migrate|reset|gen|seed|web"; exit 64 ;;
esac
