#!/usr/bin/env bash
# Actual Wrangler compilation when CLI is installed. No publish/auth/migrations.
# Uses compile-only fake UUIDs; NEVER copies prod/staging resource bindings.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PRESENTATION="${1:-$ROOT/../worker/src/admin-ui.js}"
OUTDIR="${2:-$ROOT/.wrangler-dryrun-stage11}"
CONFIG=""
cleanup() { if [[ -n "$CONFIG" ]]; then rm -f "$CONFIG"; fi; }
trap cleanup EXIT
if command -v wrangler >/dev/null 2>&1; then
  WRANGLER_BIN="$(command -v wrangler)"
elif [[ -x "$ROOT/node_modules/.bin/wrangler" ]]; then
  WRANGLER_BIN="$ROOT/node_modules/.bin/wrangler"
else
  echo 'Wrangler CLI unavailable: compilation was NOT executed.' >&2
  exit 3
fi
if [[ -f "$PRESENTATION" ]]; then
  node "$ROOT/runtime/tools/attach-admin-ui.mjs" "$PRESENTATION"
else
  # Immutable, hash-verified presentation only; never downloads legacy engine.
  node "$ROOT/runtime/tools/fetch-approved-admin-ui.mjs"
fi
CONFIG="$(node "$ROOT/runtime/staging/make-dryrun-config.mjs")"
node "$ROOT/runtime/staging/verify-staging.mjs" "$CONFIG" --compile-only
"$WRANGLER_BIN" deploy --config "$CONFIG" --dry-run --outdir "$OUTDIR"
