# Architecture

Next.js (App Router) + TypeScript `strict`, pnpm, ESLint, Vitest. Verify with `pnpm verify`.

| Module | Holds | May import |
|---|---|---|
| `src/domain/` | Pure rules, no IO: tasks and Accept / Reject decisions, Approval, evidence checks, task → recurring calendar event. Most tests live here. | itself only |
| `src/db/` | Supabase queries and row mappers. The only module that talks to Postgres. | `domain` |
| `src/calendar/` | Google Calendar adapter and OAuth helpers behind a small `CalendarWriter` interface. | `domain` |
| `src/ai/` | Server-only AI provider layer (`selectProvider`: ChatGPT-authorized → MiniMax → … → Manual). Holds any AI credentials; never imported by client code (`server-only`). Separate from Keeply login. | `domain` |
| `src/search/` | Server-only manual search. Discovery: `searchManuals` (Brave Search client) and `rankCandidates` (pure ranking). Retrieval: `fetchDocument` (SSRF-safe https fetch with DNS pinning), `extractPages` (PDF/HTML to normalised `{page,text}`), and `normalizeText` (the one normaliser; `verifyQuote` must use it). Used by the plan proposer to surface candidates for the manufacturer's manual; never imported by client code (`server-only`). Hard-stops at the free quota (`BRAVE_FREE_QUOTA_PER_MONTH`, default 2000): a refused call does not advance the per-process counter. | `domain` |
| `src/app/` | Routes and UI only. Calls domain, db and calendar; holds no business rules. | all of the above |

## MVP flow (docs/HANDOFF.md §24)

`/` → `/appliances/scan` (label photo, behind `NEXT_PUBLIC_KEEPLY_SCAN=1`) or `/appliances/new` (typed) → `/appliances/[id]/plan` (Accept / Reject each task, first reminder date, Approve) → `/appliances/[id]` (read-only: accepted tasks, calendar status, "Open Google Calendar").

- Storage seam: screens use `usePlan()` (`src/app/lib/plan-context.tsx`), which calls an async `PlanRepository` (`plan-repository.ts`): the device adapter (localStorage; local development without Supabase) or the Supabase adapter (`supabase-plan-repository.ts`, anonymous sign-in, Google sign-in optional).
- Plan finding seam: `PlanProposer` (`src/app/lib/propose.ts`) turns a confirmed dishwasher into `TaskProposal`s. Today it returns general dishwasher guidance; Phase 3 replaces it with manual search (§23). The manual search pipeline feeds the AI provider with `extractTasks({model, pages})` (`src/ai/provider.ts`, MiniMax adapter in `src/ai/minimax.ts`); the model returns candidate tasks with a page and a verbatim quote, the page text is the only normaliser the quotes are matched against (`verifyQuote` and `classifyEvidence` in `src/domain/evidence-check.ts`), and the model never decides the evidence level. With no provider or key, `extractTasks` returns `'unavailable'` and the proposer falls back to general guidance. One extraction counts as one billable attempt (`reserve_scan`, `src/db/scan-access.ts`), the same rule `/api/identify` uses.
- Supabase schema: `appliances` (per user) and their `maintenance_tasks` (the proposal, its source, the owner's decision, the calendar event id), plus `funnel_events` for beta counts. Users are Supabase Auth users.
- Google Calendar: `/auth/google/start` and `/auth/google/callback` (state cookie, `calendar.events` scope, access token in an httpOnly cookie scoped to `/api/calendar`). `/api/calendar/status` reports configured/connected; `POST /api/calendar/events` writes accepted tasks of an approved plan (with Supabase it loads them itself under the caller's session). Without `GOOGLE_*` env vars, approval saves the plan only.
- Each accepted task becomes one recurring all-day event from the start date. Event ids derive from task ids and writes are upserts, so retries never duplicate. After that the owner manages events in their calendar.
- Invited testers: `/api/identify` reserves one billable attempt per scan in Supabase (`reserve_scan`, `src/db/scan-access.ts`, `src/app/lib/scan-gate.ts`) before calling a provider: 5 per tester and 100 in total per UTC day by default, locked against concurrency, never refunded, fail closed. `/invite?code=` redeems an invite; `/api/scan-access` reports what the visitor has left. Operator guide: `docs/testers.md`.
- Label scanning: `prepareLabelPhoto` (≤1280 px JPEG, EXIF dropped) → `httpRecognizer` → `/api/identify` → `selectProvider` (MiniMax when `MINIMAX_API_KEY` is set, else Manual) → Confirm / Edit / Rescan. A recogniser only proposes; any owner edit drops its confidence. The photo is not stored.
- Hosted BYO (HANDOFF §25): `/settings/ai` → bearer-authenticated `/api/ai-key` → `src/ai/credentials.ts` → service-only `src/db/ai-credentials.ts`. AES-256-GCM ciphertext is bound to a verified non-anonymous owner and provider. Status never returns the key. Personal MiniMax keys precede the server key, use a fixed endpoint/model, and never silently fall back to app funding on failure. Invitations and scan reservations still apply. Setup: `docs/ai/byo-minimax.md`.

## Rules

- Dependencies point inward: `app` → `db` / `calendar` → `domain`. Never the reverse.
- ESLint enforces the domain boundary: `src/domain/**` cannot import `src/db`, `src/calendar`, `src/app`, `next` or `@supabase/*`. `src/domain/boundary.test.ts` proves the rule fails when violated.
- Nothing reaches a calendar before Approval, and only accepted tasks ever do. A proposed task is never rewritten. Level 2/3 evidence never renders as Manufacturer verified.
- Tests sit next to the code (`*.test.ts`). Component tests use React Testing Library with `// @vitest-environment jsdom`.
- Config: copy `.env.example` to `.env.local`; `.env*` is gitignored.
- CI (`.github/workflows/ci.yml`) runs verify, the database tests (pgTAP + adapter integration) and the phone e2e on every PR.
