# src/db

Supabase queries. The only module that talks to Postgres.

- Schema: `supabase/migrations/` (users are Supabase Auth users; `appliances` and their `maintenance_tasks`; `funnel_events` for beta counts). `appliances.proposal_*` stores the proposer's outcome so a reload shows the same banner (RF-352). Null means the plan was saved before that; the page shows a neutral banner. Tests: `supabase/tests/database/` (`supabase test db` or `scripts/db-test.sh`).
- `rows.ts` maps rows to domain types. `queries.ts` holds every read and write. The `add_appliance` RPC creates a dishwasher and its proposed tasks in one transaction; Approval is one update the database checks.
- The app's `createSupabasePlanRepository` (`src/app/lib/supabase-plan-repository.ts`) implements `PlanRepository` on these queries. It is used when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, signing visitors in anonymously; otherwise plans stay on the device.

## Testing

- Schema rules: `PGURL=postgres://postgres:…@localhost/postgres scripts/db-test.sh` (needs pgTAP).
- Adapter end to end (supabase-js → PostgREST → Postgres, RLS on): `scripts/db-integration.sh`. Needs `psql` and a `postgrest` binary on PATH.
