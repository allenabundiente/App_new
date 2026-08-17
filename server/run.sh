#!/usr/bin/env bash
# HulogTrack microservice stack runner — no docker-compose plugin required.
#
#   ./run.sh        start postgres + migrate + auth/core/engagement + gateway
#   ./run.sh stop   tear everything down
#
# This is the plain-`docker` equivalent of `docker compose up --build`
# (see docker-compose.yml for the canonical definition). The gateway is
# exposed on http://localhost:8080 with the same /api/* paths as the old
# single-process API.
set -euo pipefail

cd "$(dirname "$0")"

NAME=hulogtrack
NET=$NAME-net
PG=$NAME-pg
GW=$NAME-gw

build() {
  echo "==> building images (first run pulls base images)..."
  docker build --target auth       -t "$NAME-auth"       .
  docker build --target core       -t "$NAME-core"       .
  docker build --target engagement -t "$NAME-engagement" .
  docker build --target migrate    -t "$NAME-migrate"    .
}

up() {
  build
  docker network create "$NET" >/dev/null 2>&1 || true

  echo "==> starting postgres..."
  docker run -d --name "$PG" --network "$NET" \
    -e POSTGRES_USER=hulog -e POSTGRES_PASSWORD=hulog -e POSTGRES_DB=hulog \
    postgres:16-alpine >/dev/null

  echo "==> waiting for postgres..."
  for _ in $(seq 1 30); do
    docker exec "$PG" pg_isready -U hulog -d hulog >/dev/null 2>&1 && break
    sleep 1
  done

  echo "==> applying schema + seeding demo data (one-shot)..."
  docker run --rm --name "$NAME-migrate" --network "$NET" \
    -e "DATABASE_URL=postgres://hulog:hulog@$PG:5432/hulog" -e SEED_ON_BOOT=1 \
    "$NAME-migrate":latest

  echo "==> starting services (auth :4001, core :4002, engagement :4003)..."
  docker run -d --name "$NAME-auth" --network-alias auth --network "$NET" \
    -e "DATABASE_URL=postgres://hulog:hulog@$PG:5432/hulog" -e PORT=4001 \
    "$NAME-auth" >/dev/null
  docker run -d --name "$NAME-core" --network-alias core --network "$NET" \
    -e "DATABASE_URL=postgres://hulog:hulog@$PG:5432/hulog" -e PORT=4002 \
    "$NAME-core" >/dev/null
  docker run -d --name "$NAME-engagement" --network-alias engagement --network "$NET" \
    -e "DATABASE_URL=postgres://hulog:hulog@$PG:5432/hulog" -e PORT=4003 \
    -e CRON_SECRET=change-me-to-a-long-random-string \
    "$NAME-engagement" >/dev/null

  echo "==> starting gateway on http://localhost:8080..."
  docker run -d --name "$GW" --network "$NET" -p 8080:8080 \
    -v "$(pwd)/Caddyfile:/etc/caddy/Caddyfile:ro" \
    caddy:2-alpine >/dev/null

  sleep 4
  echo
  echo "✅ stack is up — try:"
  echo "   curl http://localhost:8080/api/health"
  echo "   docker logs -f $NAME-engagement   # watch reminders/notifications"
  echo
  echo "Stop everything with:  ./run.sh stop"
}

down() {
  echo "==> tearing down..."
  docker rm -f "$GW" "$NAME-engagement" "$NAME-core" "$NAME-auth" "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
  echo "done."
}

case "${1:-}" in
  stop) down ;;
  *)    up ;;
esac
