#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

N="${1:-}"
if [ -z "$N" ]; then
  if [ -f .run/level ]; then
    N="$(cat .run/level)"
  else
    N=10
  fi
fi

URL="${URL:-http://127.0.0.1:8080}"
API_URL="${API_URL:-http://127.0.0.1:8081}"
RUN_ID="${RUN_ID:-lokal}"
GITHUB_REPO="${GITHUB_REPO:-specrun-lab/levelboard-$RUN_ID}"
LIVE_URL="${LIVE_URL:-https://$RUN_ID.${LIVE_DOMAIN:-}}"

cd checks
mkdir -p .out
if [ ! -d node_modules ]; then
  npm ci
fi
npx playwright install chromium

rm -f .out/loadtest.json

files=()
for i in $(seq 1 "$N"); do
  files+=("tests/level$i.spec.ts")
done

BASE_URL="$URL" \
API_URL="$API_URL" \
GITHUB_REPO="$GITHUB_REPO" \
RUN_ID="$RUN_ID" \
LIVE_URL="$LIVE_URL" \
npx playwright test "${files[@]}"
pw_status=$?

write_env=(
  "GITHUB_REPO=$GITHUB_REPO"
  "RUN_ID=$RUN_ID"
  "API_URL=$API_URL"
  "LIVE_URL=$LIVE_URL"
)
if [ "$N" -ge 5 ]; then
  write_env+=("REPORT_API=1")
fi
if [ "$N" -ge 9 ]; then
  write_env+=("REPORT_LIVE=1")
fi

env "${write_env[@]}" node write-results.mjs $(seq 1 "$N")
write_status=$?

live_status=0
if [ "$N" -ge 10 ] && [ "$write_status" -eq 0 ]; then
  LIVE_URL="$LIVE_URL" RUN_ID="$RUN_ID" npx playwright test tests/live-report.spec.ts --reporter=list
  live_status=$?
fi

if [ "$pw_status" -ne 0 ] || [ "$write_status" -ne 0 ] || [ "$live_status" -ne 0 ]; then
  exit 1
fi
exit 0
