# src/db

Supabase client and queries. The only module that talks to Postgres.

- Schema: `supabase/migrations/`. Tests: `supabase/tests/database/` (`supabase test db`).
- `rows.ts` maps database rows to domain types and back. The Recommendation mapper is read-only by design: the table rejects updates.
- The app has no Supabase project yet, so plans live on the device via `createDevicePlanRepository` (`src/app/lib/plan-repository.ts`).

## Adding Supabase

1. Implement `PlanRepository` (same file) as `createSupabasePlanRepository` here, using `rows.ts` to map rows. Every method resolves to the full `PlanState`; `approve` must insert `maintenance_tasks` with `approved_at` set (use `fromTask`).
2. Insert the mock recommendations with a `source_documents` row (`source_type = 'general_guidance'`), since provenance is required.
3. Pass it to `<PlanProvider repository={…}>` in `src/app/layout.tsx`. No screen changes.
4. Have `POST /api/calendar/events` accept task ids and load approved tasks server-side instead of drafts from the browser.
