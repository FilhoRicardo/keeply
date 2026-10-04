# src/db

Supabase client and queries. The only module that talks to Postgres.

- Schema: `supabase/migrations/`. Tests: `supabase/tests/database/` (`supabase test db`).
- `rows.ts` maps database rows to domain types and back. The Recommendation mapper is read-only by design: the table rejects updates.
- `plan-queries.ts` holds every plan read and write. `add_appliance_with_recommendations` (an RPC) creates an appliance, its source and its recommendations in one transaction; approval inserts all Tasks in one statement.
- The app's `createSupabasePlanRepository` (`src/app/lib/supabase-plan-repository.ts`) implements `PlanRepository` on these queries. `createPlanRepository` picks it when `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set, signing visitors in anonymously; otherwise plans stay on the device.

## Testing

- Schema rules: `supabase test db` (pgTAP files in `supabase/tests/database/`).
- Adapter end to end (supabase-js → PostgREST → Postgres, RLS on): `PGURL=postgres://postgres:…@localhost/postgres scripts/db-integration.sh`. Needs `psql` and a `postgrest` binary on PATH.

## Going live

1. `supabase link --project-ref xmilbvzbptmozwjphvsx && supabase db push`.
2. Enable anonymous sign-ins (Authentication → Sign In / Providers).
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in Vercel.
4. Still open: `/api/calendar/events` should load approved tasks server-side (with the user's session) instead of trusting drafts from the browser.
