# PR: KEE-1 Keeply MVP

From `claude/dazzling-mayer-ytyahw` into `main`. Built by Claude Code on 2026-10-04; step-by-step record in `docs/paperclip/2026-10-04-claude-session.md`.

## What it does (docs/HANDOFF.md §24)

A visitor adds a dishwasher, by label photo (AI proposes; they Confirm, Edit or Rescan; behind `NEXT_PUBLIC_KEEPLY_SCAN=1`) or by typing. Keeply proposes maintenance tasks, each with its evidence level and source. The visitor accepts or rejects each task, picks the first reminder date and approves. Only then are the accepted tasks written to Google Calendar as recurring events; from there the owner manages them in their calendar. The plan is general dishwasher guidance until manual search (Phase 3, §23) lands.

## How the rules are enforced

| Rule | Where |
|---|---|
| Nothing reaches a calendar before Approval; rejected tasks never do | `calendarBound` / `draftsForTasks`; DB trigger `guard_maintenance_task`; the server loads the approved plan itself under the caller's session |
| Approval needs every task decided and one accepted; decisions then freeze | `approvalBlockers`; DB trigger `guard_approval` |
| A proposed task is never rewritten | DB trigger `guard_maintenance_task` |
| Inferred or general guidance never looks verified; verified needs a linked, quoted manufacturer document | `unsupportedEvidence`; DB check `evidence_supported` |
| AI only proposes; credentials server-side | Confirm / Edit / Rescan, any edit clears AI confidence; `src/ai/*` is server-only; Manual fallback |
| Minimal data | Supabase: `appliances`, `maintenance_tasks`, `funnel_events` (counts only); label photos are not stored |

## Verification

- `pnpm verify`: typecheck, lint, unit and component tests, build.
- `scripts/db-test.sh`: pgTAP schema rules. `scripts/db-integration.sh`: supabase-js → PostgREST → Postgres with RLS, and the calendar route.
- `pnpm e2e`: the MVP walkthrough on a phone viewport with axe.

## Owner actions before production

1. Supabase: run `supabase/reset-pre-mvp.sql` (projects set up with the earlier schema), then `supabase/migrations/20261005090000_mvp_schema.sql`; enable Anonymous sign-ins.
2. Google Cloud OAuth client (`calendar.events`), redirect `https://<domain>/auth/google/callback`.
3. Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`.
