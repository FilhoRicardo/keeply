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

### 5. Storage seam, calendar upsert, funnel tracking, sources (Builder 1)

Commits `08f19c3`, `b3fde87`. `src/app/lib/`, `src/calendar/`.

Steps:
1. Async `PlanRepository` interface; device adapter (localStorage with in-memory fallback when storage throws); `PlanProvider` / `usePlan()` so screens never touch storage. Supabase adapter steps in `src/db/README.md`.
2. Loading state replaces the flash of "No appliances yet." during hydration.
3. `CalendarWriter.upsertEvent`: a 409 on insert becomes a PUT, so retries never duplicate and marking a completion-based task done moves its event to the next due date.
4. Handoff §15 funnel events (appliance added → recommendations generated → decided → approved → calendar tasks created → task completed) through a pluggable sink; ids and counts only.
5. Appliance record lists sources with evidence explanation (screen G).

Verification: `pnpm verify` green (124 tests), real-browser pass at 360 px.

### 6. Supabase PlanRepository with anonymous sign-in (Builder 2; reviewer Builder 4)

Commit `38e8be9`. `supabase/migrations/20261004160000_plan_decisions.sql`, `src/db/plan-queries.ts`, `src/app/lib/supabase-plan-repository.ts`, `src/app/lib/repository.ts`, `scripts/db-integration.sh`.

Steps:
1. Migration: `plan_decisions` table (draft Include/Customise/Skip; customise must carry a full schedule; frozen by trigger once any Task exists; appliance deletion still cascades), `position` on recommendations, and RPC `add_appliance_with_recommendations` (appliance + source + recommendations in one transaction, runs as the caller under RLS).
2. pgTAP `supabase/tests/database/plan_decisions.test.sql`: 6 tests (19 total, all pass on Postgres 16).
3. `src/db/plan-queries.ts`: every plan read/write; approval inserts all Tasks in one statement.
4. `createSupabasePlanRepository` implements the same `PlanRepository` as device storage; `createPlanRepository` picks Supabase when `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set and signs visitors in anonymously.
5. Integration test through real supabase-js → PostgREST 12 → Postgres with RLS: full lifecycle, frozen decisions, cross-user isolation (2/2 pass). Run with `scripts/db-integration.sh`; excluded from `pnpm test`.
6. Storage failures show a banner with "Try again"; forms and approval reset instead of hanging.

Owner actions this needs: `supabase db push`, enable Anonymous sign-ins, set the two `NEXT_PUBLIC_SUPABASE_*` vars in Vercel (all already in KEE-23's wizard scope).

### 7. Calendar writes load approved tasks server-side (Builder 1; reviewer Builder 3)

Commit `ed8f96a`. `src/app/api/calendar/events/route.ts`, `src/app/lib/calendar-drafts.ts`, `src/app/lib/calendar-session.ts`.

Steps:
1. With Supabase configured, `POST /api/calendar/events` accepts only `{applianceId, taskIds}` plus the user's Supabase bearer token, loads the plan under that session (RLS) and builds the drafts itself. Browser-supplied drafts are rejected (400). Device mode keeps the validated-drafts path.
2. Shared `draftsForTasks` (approved tasks only, plan must be approved) used by client and server.
3. Integration test through the real route + PostgREST: owner's 2 approved tasks written, skipped task never written, other user 404, no session 401, drafts 400.

Closes the follow-up "load approved tasks server-side instead of trusting browser drafts".

### 8. CI runs database tests (Builder 2; reviewer Builder 4)

`.github/workflows/ci.yml` (new `database` job), `scripts/db-reset.sh`, `scripts/db-test.sh`, `scripts/db-integration.sh`.

Steps:
1. CI job with a Postgres 16 service, PostgREST 12 and pgTAP: runs the adapter integration test, then the pgTAP schema tests on a fresh database.
2. Scripts work locally the same way (`PGURL=… scripts/db-test.sh`, `scripts/db-integration.sh`); both pass here (3/3 integration, 19/19 pgTAP).

Risk for the reviewer: the job has not run on GitHub yet (no Actions access from the cloud session). The pgTAP install via `docker exec` into the service container is the step most likely to need a tweak.

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
- Decide whether v0.1 keeps anonymous sign-in or adds a real login (anonymous plans are lost if the browser's session is cleared).
- Migrate a device-stored plan into Supabase on first sign-in (currently not migrated).
- Supabase sink for funnel events (an `events` table).
- `calendar_connected` funnel event (needs a server-side or post-redirect hook).

Done in this session (were follow-ups): completion-based calendar rescheduling, hydration placeholder, storage fallback, Supabase adapter, server-side calendar task loading.
