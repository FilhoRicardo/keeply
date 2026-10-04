# PR draft: KEE-1 Phase 0 + 1 (and Phase 2/3 groundwork behind a flag)

For the CTO to open from `claude/dazzling-mayer-ytyahw` into `main`. Built by Claude Code on the Builders' behalf on 2026-10-04 while Paperclip agents were paused; step-by-step record in `docs/paperclip/2026-10-04-claude-session.md`.

## What it does

A visitor adds a dishwasher (manually; or by label photo when `NEXT_PUBLIC_KEEPLY_SCAN=1`), sees proposed maintenance tasks with their evidence level and source, chooses Include / Customise / Skip for each, approves, and only then are the approved tasks written to Google Calendar. The appliance record shows next due dates, completions, pause/resume and schedule changes, all kept in sync with the calendar.

## How the non-negotiables are enforced

| Rule | Where |
|---|---|
| Nothing reaches a calendar before Approval | `approvePlan` is the only Task constructor; `calendarBound` filters; DB check `calendar_only_after_approval`; server builds drafts from approved tasks under the caller's session |
| Inferred/general guidance never looks verified | Evidence copy (`evidence.ts`), `unsupportedEvidence` + DB trigger, catalog matching (exact → verified, family → similar-model) |
| Recommendation stored separately, never rewritten | Immutable-row trigger; owner's schedule lives on the Task |
| Completion-based scheduling from day one | `nextDue`, calendar upsert moves the single event on completion |
| Provenance is first-class | `source_document_id not null`; catalog rows cite an https manufacturer document and a named checker |
| Dishwashers only, mobile-first, ~€0 infra | DB check on category; Pixel 7 e2e with axe; Supabase free tier, no paid APIs |

## Modules

`src/domain` (pure rules) · `src/db` (Supabase queries, row mappers) · `src/calendar` (Google adapter behind `CalendarWriter`) · `src/app` (screens, `PlanRepository` seam: device storage or Supabase with anonymous sign-in). See `docs/architecture.md`.

## Database

Migrations `20261004120000` … `20261004220000`: schema + RLS, plan decisions, funnel events + summary view, appliance photos bucket, evidence guard, guidance catalog, completion rules.

## Verification

- `pnpm verify`: typecheck, lint, 203 unit/component tests, build.
- `scripts/db-test.sh`: 43 pgTAP tests. `scripts/db-integration.sh`: 7 integration tests (supabase-js → PostgREST → Postgres, RLS, calendar route).
- `pnpm e2e`: 3 Playwright tests on a phone viewport with axe.
- CI runs all of the above. The `database` and `e2e` jobs have not run on GitHub yet; the pgTAP install step is the likeliest to need a tweak.
- Each slice had a code-review pass; findings and fixes are listed per slice in the Paperclip record.

## Owner actions before production

1. `supabase link --project-ref xmilbvzbptmozwjphvsx && supabase db push`; enable Anonymous sign-ins.
2. Google Cloud OAuth client (`calendar.events`), redirect `https://<domain>/auth/google/callback`.
3. Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. Leave `NEXT_PUBLIC_KEEPLY_SCAN` unset for Phase 1.
4. Brand owner: confirm the darkened `--aster-ink-3` / `--aster-green-soft` (WCAG AA).

## Open decisions

- Sign in with Google is built (anonymous plans upgrade in place); enable the Supabase Google provider and Manual linking to switch it on.
- When to enable scanning, and which AI provider in `src/ai/provider.ts` is built first (Phase 2 AI; ChatGPT only after the research in `docs/ai/chatgpt-integration-plan.md` is confirmed).
- Who fills the guidance catalog, from which manuals (`docs/guidance-catalog.md`).
