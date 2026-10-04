#!/usr/bin/env bash
# Runs the Supabase adapter integration test against a throwaway local Postgres + PostgREST.
# Needs: psql access as a superuser (PGURL), a `postgrest` binary on PATH, pgTAP optional.
# Usage: PGURL=postgres://postgres@localhost/postgres scripts/db-integration.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PGURL=${PGURL:-postgres://postgres@localhost/postgres}
DB=keeply_integration
SECRET=${KEEPLY_JWT_SECRET:-keeply-local-integration-secret-0123456789}
PORT=${KEEPLY_POSTGREST_PORT:-3901}

psql "$PGURL" -q -c "drop database if exists $DB" -c "create database $DB"
DBURL="${PGURL%/*}/$DB"
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f supabase/tests/local-supabase-stub.sql
for f in supabase/migrations/*.sql; do psql "$DBURL" -q -v ON_ERROR_STOP=1 -f "$f"; done

AUTH_URL=$(echo "$DBURL" | sed -E 's#://[^@/]+@#://authenticator:authpass@#')
PGRST_DB_URI="$AUTH_URL" PGRST_DB_SCHEMAS=public PGRST_DB_ANON_ROLE=anon PGRST_JWT_SECRET="$SECRET" \
  PGRST_SERVER_PORT=$PORT postgrest >/tmp/keeply-postgrest.log 2>&1 &
PID=$!
trap 'kill $PID' EXIT
for _ in $(seq 1 50); do curl -s "http://localhost:$PORT/" >/dev/null && break; sleep 0.2; done

KEEPLY_POSTGREST_URL="http://localhost:$PORT" KEEPLY_JWT_SECRET="$SECRET" KEEPLY_INTEGRATION_DB="$DBURL" \
  pnpm vitest run --config vitest.integration.config.mts
