#!/usr/bin/env bash
set -eu

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LEVEL="${1:?Level fehlt}"
RUN_ID="${RUN_ID:-lokal}"
GITHUB_REPO="${GITHUB_REPO:-specrun-lab/levelboard-$RUN_ID}"
LIVE_URL="${LIVE_URL:-https://$RUN_ID.${LIVE_DOMAIN:-}}"

mkdir -p .run

build_frontend() {
  (cd frontend && npm ci && npm run build)
}

build_backend() {
  (cd backend && go build -o bin/levelboard-backend .)
}

start_preview() {
  (
    cd frontend
    exec ./node_modules/.bin/vite preview --host 127.0.0.1 --port 8080
  ) </dev/null >.run/frontend.log 2>&1 &
  echo $! >.run/frontend.pid
}

start_nginx() {
  local conf="$1"
  mkdir -p .run/nginx-tmp/client_body .run/nginx-tmp/proxy .run/nginx-tmp/fastcgi .run/nginx-tmp/uwsgi .run/nginx-tmp/scgi
  nginx -p "$ROOT/" -e .run/nginx-error.log -c "frontend/$conf"
}

start_backend() {
  (
    cd backend
    exec env LEVELBOARD_DB="$ROOT/.run/levelboard.db" ./bin/levelboard-backend
  ) </dev/null >>.run/backend.log 2>&1 &
  echo $! >.run/backend.pid
}

reset_database() {
  rm -f .run/levelboard.db .run/levelboard.db-wal .run/levelboard.db-shm
}

wait_url() {
  local url="$1"
  local i
  for i in $(seq 1 120); do
    if curl -fsS -o /dev/null "$url" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

fail_logs() {
  echo "Fehler: $1 antwortet nicht." >&2
  local file
  for file in .run/frontend.log .run/backend.log .run/nginx-error.log .run/nginx-access.log; do
    if [ -f "$file" ]; then
      echo "--- $file ---" >&2
      tail -n 50 "$file" >&2 || true
    fi
  done
  exit 1
}

build_frontend

if [ "$LEVEL" -eq 1 ]; then
  start_preview
  echo 1 >.run/level
  wait_url http://127.0.0.1:8080/ || fail_logs "http://127.0.0.1:8080/"
  echo "Levelboard läuft auf http://127.0.0.1:8080"
  exit 0
fi

if [ "$LEVEL" -eq 2 ]; then
  start_nginx nginx.conf
  echo 2 >.run/level
  wait_url http://127.0.0.1:8080/ || fail_logs "http://127.0.0.1:8080/"
  echo "Levelboard läuft auf http://127.0.0.1:8080"
  exit 0
fi

build_backend

CONF=nginx.conf
if [ "$LEVEL" -ge 5 ]; then
  CONF=nginx-api.conf
fi
start_nginx "$CONF"

reset_database
start_backend

if [ "$LEVEL" -ge 5 ]; then
  printf '{"source":"api"}' >frontend/dist/config.json
fi

echo "$LEVEL" >.run/level

wait_url http://127.0.0.1:8081/api/health || fail_logs "http://127.0.0.1:8081/api/health"
if [ "$LEVEL" -ge 5 ]; then
  wait_url http://127.0.0.1:8080/api/health || fail_logs "http://127.0.0.1:8080/api/health"
else
  wait_url http://127.0.0.1:8080/ || fail_logs "http://127.0.0.1:8080/"
fi

if [ "$LEVEL" -ge 5 ]; then
  echo "Levelboard läuft auf http://127.0.0.1:8080 (Quelle: Backend)"
else
  echo "Levelboard läuft auf http://127.0.0.1:8080"
fi
echo "Backend läuft auf http://127.0.0.1:8081"
if [ "$LEVEL" -ge 4 ]; then
  echo "Datenbank: .run/levelboard.db"
fi
if [ "$LEVEL" -ge 6 ]; then
  echo "Repo: https://github.com/$GITHUB_REPO"
fi
if [ "$LEVEL" -ge 7 ]; then
  echo "Images: ghcr.io/$GITHUB_REPO-frontend und ghcr.io/$GITHUB_REPO-backend"
fi
if [ "$LEVEL" -ge 8 ]; then
  echo "Live: $LIVE_URL"
fi
if [ "$LEVEL" -ge 9 ]; then
  echo "Live-Prüfung gegen $LIVE_URL"
fi
if [ "$LEVEL" -ge 10 ]; then
  echo "Abschlussbericht: $LIVE_URL"
fi
