#!/usr/bin/env bash
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bash scripts/stop-backend.sh
(cd backend && go build -o bin/levelboard-backend .)

(
  cd backend
  exec env LEVELBOARD_DB="$ROOT/.run/levelboard.db" ./bin/levelboard-backend
) </dev/null >>.run/backend.log 2>&1 &
echo $! >.run/backend.pid

for _ in $(seq 1 120); do
  if curl -fsS -o /dev/null http://127.0.0.1:8081/api/health 2>/dev/null; then
    echo "Backend neu gestartet (Datenbank erhalten)"
    exit 0
  fi
  sleep 0.5
done

echo "Fehler: Backend antwortet nach dem Neustart nicht." >&2
[ -f .run/backend.log ] && tail -n 50 .run/backend.log >&2
exit 1
