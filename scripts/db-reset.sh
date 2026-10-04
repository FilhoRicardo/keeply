#!/usr/bin/env bash
# Recreates a throwaway database with the local Supabase stand-in and every migration.
# Usage: PGURL=postgres://postgres:…@localhost/postgres scripts/db-reset.sh [dbname]  → prints the new DB URL
set -euo pipefail
cd "$(dirname "$0")/.."
PGURL=${PGURL:-postgres://postgres@localhost/postgres}
DB=${1:-keeply_integration}
psql "$PGURL" -q -c "drop database if exists $DB" -c "create database $DB" >&2
DBURL="${PGURL%/*}/$DB"
psql "$DBURL" -q -v ON_ERROR_STOP=1 -f supabase/tests/local-supabase-stub.sql >&2 2>/dev/null
for f in supabase/migrations/*.sql; do psql "$DBURL" -q -v ON_ERROR_STOP=1 -f "$f" >&2; done
echo "$DBURL"
