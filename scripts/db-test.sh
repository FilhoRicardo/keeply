#!/usr/bin/env bash
# Runs the pgTAP schema tests on a fresh local database (same checks as `supabase test db`).
# Needs pgTAP installed in the Postgres server. Usage: PGURL=… scripts/db-test.sh
set -euo pipefail
cd "$(dirname "$0")/.."
DBURL=$(scripts/db-reset.sh keeply_pgtap)
failed=0
for t in supabase/tests/database/*.sql; do
  out=$(psql "$DBURL" -q -t -v ON_ERROR_STOP=1 -f "$t")
  echo "$out" | grep -E "ok|#" || true
  if echo "$out" | grep -q "not ok"; then failed=1; fi
done
exit $failed
