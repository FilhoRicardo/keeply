# Paperclip record: 2026-10-04 Claude Code session

Work done by Claude Code on the Builders' behalf while Paperclip agents were paused for the usage reset. The session could not reach Paperclip, so this file holds what should be entered there. Issue numbers are assigned on import; titles are written so they can be pasted as-is.

- Branch: `claude/dazzling-mayer-ytyahw` (from `main` at `e0675ba`)
- Parent: KEE-1 (Phase 0 + 1 skeleton), project Keeply v0.1
- Verification on every commit: `pnpm verify` green (116 tests, production build). Schema: 13/13 pgTAP tests against local Postgres 16 with a Supabase `auth` stand-in.

## Issues to create (status: In review)

### 1. Domain model: evidence, decisions, approval, scheduling (Builder 1)

Commit `b051487`. `src/domain/`.

Steps:
1. Evidence levels with distinct labels and explanations; levels 2/3 never contain "verified" (`evidence.ts`).
2. `Recommendation` (read-only) vs `Task` (owner's interval, start date, scheduling mode) in `model.ts`.
3. Include / Customise / Skip decisions, approval blockers, `approvePlan` as the only Task constructor, `calendarBound` filter (`plan.ts`).
4. Day-granular `LocalDate` arithmetic with month-end clamping (`dates.ts`).
5. `nextDue` for `fixed_calendar` and `completion_based` (handoff §6 example is a test) (`schedule.ts`).
6. RRULE mapping and provider-neutral `CalendarEventDraft` that shows user schedule, recommendation, evidence and source (`recurrence.ts`, `calendar-event.ts`).
7. Three mock dishwasher recommendations, labelled General guidance because a manual entry has no model lookup (`mock-recommendations.ts`).

Decision recorded: tasks included as recommended default to `fixed_calendar` (one recurring event); Customise can choose completion-based.

### 2. Initial Supabase schema with RLS (Builder 2)

Commit `f680ab4`. `supabase/migrations/20261004120000_initial_schema.sql`, `supabase/tests/database/schema.test.sql`, `src/db/rows.ts`.

Steps:
1. Tables from handoff §9 with enums for evidence level, interval unit, task status, scheduling mode, source type.
2. Database-level guards: recommendations immutable (update trigger), provenance required, composite FKs keep task/recommendation/source on the same appliance, `calendar_event_id` only on approved tasks with `approved_at`, dishwashers only.
3. Sign-up trigger creates profile and default home; RLS scopes every table to the owner.
4. pgTAP tests for each guard and for cross-user isolation.
5. Typed row ↔ domain mappers.

Not done: no Supabase project exists yet (needs the owner's account). `supabase test db` was not run with the CLI; the same tests ran on plain Postgres 16.

### 3. CalendarWriter and Google Calendar adapter (Builder 1)

Commit `7e00cfd`. `src/calendar/`.

Steps:
1. `CalendarWriter` interface and `writeEvents` with per-task results.
2. Google writer: all-day events, RRULE for fixed-calendar tasks, deterministic event id from Task id (409 = already written, so retries never duplicate).
3. OAuth helpers: `calendar.events` scope only, online access, scope check on token exchange.

### 4. Phase 1 UI: manual entry → plan review → approval → calendar (Builder 2)

Commit `7747a5d`. `src/app/`. Screenshots in `docs/screenshots/kee-1-*.png`.

Steps:
1. `/appliances/new` manual dishwasher form (manufacturer required).
2. `/appliances/[id]/plan` cards with evidence badge, "Why? / View source", Include / Customise / Skip; Customise edits frequency, start date and timing while the recommendation stays visible.
3. `/appliances/[id]/approve` summary, start date, Google connect (adds nothing), "Approve maintenance plan" creates Tasks then writes only approved ones.
4. `/appliances/[id]` record: identity, next due, schedule vs recommendation, completions, calendar retry.
5. OAuth routes and `/api/calendar/{status,events}`; without `GOOGLE_*` env the plan is saved on the device.
6. Plan state in localStorage until Supabase exists.
7. Verified end to end in Chromium at 360 px; no horizontal overflow.

## Review requests for Builders 3–4 (Codex)

Please review the branch commit by commit and comment on Paperclip or the PR. Focus:

1. Non-negotiables: can any path write a calendar event before approval, show level 2/3 as verified, or change a Recommendation?
2. `src/app/api/calendar/events/route.ts`: input validation, cookie handling, CSRF exposure (SameSite=Lax, JSON body).
3. `src/app/auth/google/*`: state check, open-redirect protection (`safeReturnTo`), cookie scopes.
4. Schema constraints and RLS policies in the migration; anything missing for Supabase defaults (grants, `auth.uid()` usage).
5. `nextDue` and month-end handling in `dates.ts`.

## Follow-ups (create as Backlog)

- Provision Supabase project and Vercel deploy; fill `.env.local` (owner action: accounts).
- Create Google OAuth client with `calendar.events` scope and redirect URIs (owner action).
- Move plan persistence from localStorage to `src/db` and have `/api/calendar/events` load approved tasks server-side instead of trusting browser drafts.
- Completion-based tasks: move the calendar event when a completion is recorded.
- Home briefly shows the empty state before stored appliances load; render a neutral placeholder during hydration.
- Wrap localStorage access for browsers where it throws (private mode).
