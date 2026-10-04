# src/db

Supabase client and queries. The only module that talks to Postgres.

- Schema: `supabase/migrations/`. Tests: `supabase/tests/database/` (`supabase test db`).
- `rows.ts` maps database rows to domain types and back. The Recommendation mapper is read-only by design: the table rejects updates.
- The app has no Supabase project yet, so `src/app` keeps the plan in browser storage (`src/app/lib/plan-store.ts`). Swap that store for queries here once the project exists.
