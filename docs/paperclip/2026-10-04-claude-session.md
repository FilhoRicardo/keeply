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

### 9. Security headers for the Vercel deploy (Builder 1; reviewer Builder 3)

`next.config.ts`, `src/app/security-headers.test.ts`.

Steps:
1. CSP limited to self, Google Fonts and `*.supabase.co`; `frame-ancestors 'none'`, `object-src 'none'`; `unsafe-eval` only in dev.
2. nosniff, Referrer-Policy, X-Frame-Options DENY, HSTS, Permissions-Policy (camera kept for Phase 2 scan), `x-powered-by` off.
3. Verified on a production build: full flow in Chromium with no CSP violations.

Known limit: scripts still need `'unsafe-inline'` (no nonce setup yet).

### 10. Funnel events stored in Supabase; calendar_connected tracked (Builder 2; reviewer Builder 4)

`supabase/migrations/20261004170000_funnel_events.sql`, `supabase/tests/database/funnel_events.test.sql`, `src/app/lib/track.ts`, `src/app/lib/repository.ts`, `src/app/lib/plan-context.tsx`.

Steps:
1. `funnel_events` table: known event names only, small props object, append-only for visitors (insert own rows; no select/update/delete). Analysis via the service role.
2. pgTAP: 4 tests (23 total pass).
3. `supabaseSink` writes events after the session is ready; `createPlanBackend` pairs it with the Supabase repository. Device mode keeps the console/no-op sink.
4. `calendar_connected` recorded once when Google redirects back with `?calendar=connected`; the query is removed from the URL.
5. Integration test: events land under the visitor's own id (4/4 integration tests pass).

### 11. Playwright Phase 1 walkthrough in CI (Builder 2; reviewer Builder 4)

`e2e/phase1.spec.ts`, `playwright.config.ts`, CI job `e2e`, `pnpm e2e`.

Steps:
1. Pixel 7 viewport against a production build: add dishwasher → three General guidance cards (no "verified") → Include / Customise (2 months, completion-based) / Why? / Skip → approval summary → approve (device mode) → record → mark done → Home shows "2 active tasks". Asserts no horizontal scroll and no console errors (CSP included).
2. Google connect without config redirects safely (open-redirect attempt falls back to `/`); events route refuses without a token.
3. Passes locally (2/2). CI job not yet run on GitHub.

### 12. Home shows the next task; accessibility checks in e2e (Builder 2; reviewer Builder 4)

`src/app/appliance-list.tsx`, `e2e/phase1.spec.ts`.

Steps:
1. Home appliance row: "N active tasks · Next: <task>, <date>" or "<task> overdue since <date>"; skipped tasks ignored.
2. axe-core WCAG 2 A/AA scan on Home, add form, plan review, approval and record screens: no violations.

Known limit: axe cannot compute colour contrast over the translucent "glass" panels; checked by hand in slice 15.

### 13. README and go-live notes (Builder 1)

`README.md`: run, checks (verify, e2e, pgTAP, integration), go-live steps, enforced rules.

Note for the CEO/CTO on KEE-23: the app connects to Google Calendar itself with `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` in Vercel (redirect `https://<domain>/auth/google/callback`). The **Supabase Google auth provider is not needed** unless Google sign-in is added later. The service-role key is not used by the app.

### 14. Delete a dishwasher (Builder 2; reviewer Builder 4)

`src/app/components/delete-appliance.tsx`, `deleteAppliance` on both repositories, `src/db/plan-queries.ts`.

Steps:
1. "Delete this dishwasher" on the plan and record screens, with a confirm step. Removes the appliance and everything under it from Keeply; says plainly that events already in Google Calendar stay there (Keeply never deletes calendar events).
2. Device and Supabase repositories; Supabase delete cascades under RLS and reports "Unknown appliance" for someone else's id.
3. Tests: component flow, device repository, integration (cascade leaves no rows; other user cannot delete). 140 unit/component, 5 integration, 2 e2e pass.

### 15. Text contrast to WCAG AA (Builder 2; reviewer Builder 4; brand owner to confirm)

`src/app/globals.css`.

Steps:
1. Measured small text against the darkest background it sits on (`#e1e7e3`): `--aster-ink-3` `#8a928d` was 2.55:1 and `--aster-green-soft` `#5f9d79` 2.54:1 (AA needs 4.5:1).
2. Darkened to `#5f6661` (4.7:1) and `#2f6e49` (4.86:1). These deviate from the Aster tokens; the brand owner should confirm or pick other AA-passing values.

### 16. Change a task's schedule after approval (Builder 1; reviewer Builder 3)

`rescheduleTask` in `src/domain/plan.ts`; `updateTaskSchedule` in plan-state, both repositories and `src/db/plan-queries.ts`; record screen.

Steps:
1. "Change schedule" on each approved task opens the same Customise form (frequency, start date, timing). Only the Task changes; the Recommendation stays as it was and is still shown.
2. If the task is already in Google Calendar, the event is updated in place (same event id, new date/recurrence); otherwise the owner is told to connect.
3. Tests: domain, component flow (event rewritten with `RRULE:FREQ=WEEKLY;INTERVAL=6`), integration under RLS (skipped task refused). 143 unit/component, 5 integration, 2 e2e pass.

### 17. Service worker caches static assets (Builder 2; reviewer Builder 4)

`public/sw.js`, e2e "works offline after the first visit".

Steps:
1. Cache-first for `/_next/static/*` (content-hashed, immutable); old caches removed on activate. Pages stay network-first with the offline page as fallback; plan data is never cached by the worker.
2. e2e: after one visit the worker controls the page, static files are cached, and an offline navigation shows the offline page. 3/3 e2e pass.

### 18. Fix: overlapping saves could show stale decisions (Builder 1; reviewer Builder 3)

`src/app/lib/plan-context.tsx`.

Found in self-review: with a network store, two quick taps (e.g. Include on one card, Skip on another) ran concurrently; if the first response arrived last, its older snapshot overwrote the newer state and a saved decision looked missing. Mutations now run one at a time through a queue. Regression test fails without the fix and passes with it.

### 19. Funnel summary view; disconnect Google Calendar (Builder 2; reviewer Builder 4)

`supabase/migrations/20261004180000_funnel_summary.sql`, `src/app/api/calendar/disconnect/route.ts`, `revokeGoogleToken`, record screen.

Steps:
1. `funnel_summary` view (security invoker): distinct visitors and events per §15 step, first/last seen. Team reads it with the service role / SQL editor; visitors are refused (pgTAP, 25 total pass).
2. "Disconnect" next to "Google Calendar connected" on the record screen: revokes the token at Google (best effort), clears the cookie, and says events already added stay in the calendar.
3. Tests: revoke call, component flow. 146 unit/component, 3 e2e pass.

### 20. Calendar permission denied is explained (Builder 2; reviewer Builder 4)

`src/app/components/calendar-return-notice.tsx`, approval and record screens.

Handoff Phase 5 lists "calendar permission denial". Before this, declining Google consent returned the owner to the approval page with no explanation. Now `?calendar=denied` / `?calendar=error` show what happened ("nothing was added"), the connect button stays, and approval still works (saves without writing). Component test covers it. 147 unit/component, 3 e2e pass.

### 21. Phase 2 groundwork, no AI, behind a flag (Builder 2 + Builder 1; reviewers Builder 4 + Builder 3)

Decided by Ricardo on 2026-10-04: use spare credits for Phase 2 groundwork without AI recognition. Off unless `NEXT_PUBLIC_KEEPLY_SCAN=1`, so the Phase 1 milestone is unchanged for users.

Files: `src/domain/identification.ts`, `src/app/appliances/scan/*`, `src/app/lib/photo.ts`, `src/app/lib/features.ts`, `supabase/migrations/20261004190000_appliance_photos.sql`, `supabase/tests/database/appliance_photos.test.sql`, repositories, record screen.

Steps:
1. Domain: `ApplianceIdentification`, `ApplianceRecognizer` interface with `noRecognizer` (v0.1), `editIdentification` (any owner edit drops the recogniser's confidence), `validateIdentification`, `fitWithin`.
2. Scan screen (handoff screen B): guidance to photograph the label; camera/file input; photo downscaled to ≤1280 px JPEG in the browser (also strips EXIF/GPS).
3. Confirm screen (handoff screen C): photo preview; with a proposal: "Is this correct?" + Confirm / Edit / Rescan; without (v0.1): says plainly that labels cannot be read yet and asks the owner to type.
4. Storage: private bucket `appliance-photos`, one folder per owner (RLS on `storage.objects`); `image_url` holds the path and the app shows 1-hour signed URLs. Device mode keeps photos ≤300 KB inline. Add-appliance RPC now stores `identification_confidence`.
5. Record screen shows the label photo; Home shows "Scan appliance" only when the flag is on. CSP allows `*.supabase.co` images.
6. Tests: domain, scan flow (no recogniser; fake recogniser confirm keeps confidence 0.82; edit drops it; rescan), device photo size limit, pgTAP 5 (bucket private, own folder only). Real-browser check with the flag on: PNG re-encoded to JPEG, blob preview allowed by CSP, no console errors. Screenshots `docs/screenshots/kee-1-scan-360.png`, `kee-1-confirm-360.png`. Totals: 159 unit/component, 5 integration, 3 e2e, 30 pgTAP.

Owner action when enabling: none beyond `supabase db push` (the migration creates the bucket).

### 22. Fix: deleting a dishwasher also removes its label photo (Builder 2; reviewer Builder 4)

`src/db/plan-queries.ts`, `src/db/plan-queries.test.ts`.

Found in self-review of slice 21: database rows cascade on delete, but Supabase Storage does not, so a deleted dishwasher's private photo would stay in the bucket. `deleteAppliance` now removes the photo after the row and reports if it could not. 4 tests with a fake client (163 total pass; integration 5/5).

### 23. Evidence levels must be backed by their source (Builder 1; reviewer Builder 3)

Phase 3 checklist item "Prevent unsupported claims from being labelled verified", done without AI. `unsupportedEvidence` in `src/domain/evidence.ts`; `supabase/migrations/20261004200000_evidence_guard.sql`; `supabase/tests/database/evidence_guard.test.sql`.

Rule (same in TypeScript and a database trigger, so any future pipeline, including AI, is bound by it):
- Manufacturer verified: source must be a manufacturer manual or website whose model scope equals the appliance's model (case and punctuation ignored).
- Similar-model guidance: manufacturer or similar-model source.
- General guidance: any source (provenance is already required).

Tests: 4 domain (incl. all mock recommendations stay valid), 5 pgTAP (exact model accepted; other model, general source, similar-model from general all rejected). 167 unit/component, 35 pgTAP, 5 integration pass.

### 24. Code review of the whole branch, fixes (Builder 1; reviewer Builder 3)

Ran a structured code review over `origin/main...HEAD` (medium effort). Three findings, all fixed:
1. Device storage full → newest plan lost: a failed localStorage write let the next change reload the older saved plan. The device repository now keeps the in-memory plan authoritative until a write succeeds (regression test).
2. Month-end calendar mismatch: Keeply clamps 31 Jan → 28 Feb, but a plain `FREQ=MONTHLY` rule makes Google skip short months (31 Jan, 31 Mar, 31 May…), so ~5 reminders a year never appeared. `toRRule` now adds `BYMONTHDAY=28..d;BYSETPOS=-1` for start days 29–31 (and Feb 29 yearly), giving exactly Keeply's dates. Verified with the `rrule` RFC 5545 engine for 5 start dates × 24 occurrences; the events route accepts only these rule shapes.
3. "Add to Google Calendar" could stay disabled after an error: retry now always re-enables.

177 unit/component tests pass.

### 25. Curated guidance catalog: evidence without AI (Builder 1 + Builder 2; reviewers Builder 3 + Builder 4)

Phase 3 groundwork, no AI. `src/domain/guidance.ts`, `supabase/migrations/20261004210000_guidance_catalog.sql`, `loadCatalog` in `src/db/plan-queries.ts`, both repositories, `docs/guidance-catalog.md`.

Steps:
1. `guidance_catalog` table: one task per row, checked by a named person against a manufacturer document (https reference, page, verified_by/on). Signed-in visitors read; only the team writes. Ships empty: never invent intervals.
2. `proposeRecommendations`: exact model → Manufacturer verified; family prefix (`SMS6*`) → Similar-model guidance; otherwise the three General guidance tasks. Each result passes the evidence guard.
3. Add-appliance RPC stores a source per recommendation (identical sources once).
4. Plan screen intro says "general tasks" only when all are general; otherwise "each task shows where its guidance comes from".
5. Review pass (code-review skill) found one bug: the manufacturer lookup used `ilike` on raw input, so `\`, `%`, `_` could break it or miss "Fisher & Paykel". Fixed by matching letters/digits only, with exact matching in the domain.
6. Tests: 5 domain, 6 pgTAP, 1 component, 1 integration (exact / family / none). Totals: 187 unit/component, 6 integration, 3 e2e, 41 pgTAP.

Team action: fill the catalog from real manuals using `docs/guidance-catalog.md`.

### 26. Pause and resume a task (Builder 1 + Builder 2; reviewers Builder 3 + Builder 4)

`pauseTask` / `resumeTask` in `src/domain/plan.ts`; `CalendarWriter.deleteEvent`, `removeEvents`; `DELETE /api/calendar/events`; both repositories; record screen.

Steps:
1. "Pause reminders" on an active task: status becomes paused (schedule and history kept), and its Google event is deleted. Resume makes it active and writes the event again (same id; bodies say `status: confirmed` so a cancelled event is revived).
2. `DELETE /api/calendar/events`: event ids derive from Keeply task ids, so only Keeply's own events can be removed; with Supabase the server deletes only the caller's paused tasks (another user gets 404).
3. Review pass found and fixed: a failed removal (not connected / expired token) was never retried, and an expired token was not reflected. The calendar panel now lists paused tasks whose reminders still exist, with "Remove from Google Calendar", and 401 flips the screen to Connect.
4. Tests: domain, Google delete (404/410 tolerated), component pause/resume and failed-removal retry, integration (RLS, paused-only delete). 196 unit/component, 7 integration, 3 e2e pass.

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

Done in this session (were follow-ups): completion-based calendar rescheduling, hydration placeholder, storage fallback, Supabase adapter, server-side calendar task loading.
