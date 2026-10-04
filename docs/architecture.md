# Architecture

Next.js (App Router) + TypeScript `strict`, pnpm, ESLint, Vitest. Verify with `pnpm verify`.

| Module | Holds | May import |
|---|---|---|
| `src/domain/` | Pure plan logic, no IO: Recommendation → Task decisions, Approval rules, interval → recurrence mapping. Most tests live here. | itself only |
| `src/db/` | Supabase client and queries. The only module that talks to Postgres. | `domain` |
| `src/calendar/` | Google Calendar adapter and OAuth helpers behind a small `CalendarWriter` interface. | `domain` |
| `src/ai/` | Server-only AI provider layer (`selectProvider`: ChatGPT-authorized → BYO key → Keeply-hosted → Manual). Holds any AI credentials; never imported by client code (`server-only`). Separate from Keeply login. | `domain` |
| `src/app/` | Routes and UI only. Calls domain, db and calendar; holds no business rules. | all of the above |

## Phase 1 flow

`/` → `/appliances/new` → `/appliances/[id]/plan` (Include / Customise / Skip) → `/appliances/[id]/approve` → `/appliances/[id]` (record, next due, completions).

- Storage seam: screens use `usePlan()` (`src/app/lib/plan-context.tsx`), which calls an async `PlanRepository` (`plan-repository.ts`). Today it is the device adapter (localStorage, falls back to memory; transitions in `plan-state.ts`). A Supabase adapter plugs into `<PlanProvider>` without screen changes; steps in `src/db/README.md`.
- Google Calendar: `/auth/google/start` and `/auth/google/callback` (state cookie, `calendar.events` scope, access token in an httpOnly cookie scoped to `/api/calendar`). `/api/calendar/status` reports configured/connected; `POST /api/calendar/events` validates drafts and writes them. Without `GOOGLE_*` env vars, approval saves on the device only.
- Event ids are derived from Task ids and writes are upserts, so retries never duplicate and marking a completion-based task done moves its event to the next due date.

## Phase 2 groundwork (behind `NEXT_PUBLIC_KEEPLY_SCAN=1`)

`/appliances/scan`: photograph the label → `prepareLabelPhoto` (≤1280 px JPEG, EXIF dropped) → `ApplianceRecognizer.recognise` (`noRecognizer` in v0.1) → Confirm / Edit / Rescan → `addAppliance` with the photo. A recogniser only proposes; any owner edit drops its confidence. Photos: private bucket `appliance-photos/<user>/<appliance>.jpg` (Supabase) or an inline thumbnail ≤300 KB (device).

## Rules

- Dependencies point inward: `app` → `db` / `calendar` → `domain`. Never the reverse.
- ESLint enforces the domain boundary: `src/domain/**` cannot import `src/db`, `src/calendar`, `src/app`, `next` or `@supabase/*`. `src/domain/boundary.test.ts` proves the rule fails when violated.
- Nothing reaches a calendar before Approval. A Recommendation is never edited; the user's choices live on the Task. Level 2/3 Evidence levels never render as Manufacturer verified.
- Tests sit next to the code (`*.test.ts`). Component tests use React Testing Library with `// @vitest-environment jsdom`.
- Config: copy `.env.example` to `.env.local`; `.env*` is gitignored.
- CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → test → build on every PR.
