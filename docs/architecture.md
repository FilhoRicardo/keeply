# Architecture

Next.js (App Router) + TypeScript `strict`, pnpm, ESLint, Vitest. Verify with `pnpm verify`.

| Module | Holds | May import |
|---|---|---|
| `src/domain/` | Pure plan logic, no IO: Recommendation → Task decisions, Approval rules, interval → recurrence mapping. Most tests live here. | itself only |
| `src/db/` | Supabase client and queries. The only module that talks to Postgres. | `domain` |
| `src/calendar/` | Google Calendar adapter and OAuth helpers behind a small `CalendarWriter` interface. | `domain` |
| `src/app/` | Routes and UI only. Calls domain, db and calendar; holds no business rules. | all of the above |

## Phase 1 flow

`/` → `/appliances/new` → `/appliances/[id]/plan` (Include / Customise / Skip) → `/appliances/[id]/approve` → `/appliances/[id]` (record, next due, completions).

- Until a Supabase project exists, plan state lives in browser storage: `src/app/lib/plan-state.ts` (pure transitions, tested) and `plan-store.ts` (localStorage + `useSyncExternalStore`). Replace the store with `src/db` queries when Supabase is provisioned.
- Google Calendar: `/auth/google/start` and `/auth/google/callback` (state cookie, `calendar.events` scope, access token in an httpOnly cookie scoped to `/api/calendar`). `/api/calendar/status` reports configured/connected; `POST /api/calendar/events` validates drafts and writes them. Without `GOOGLE_*` env vars, approval saves on the device only.
- Event ids are derived from Task ids, so retrying a write never duplicates an event.

## Rules

- Dependencies point inward: `app` → `db` / `calendar` → `domain`. Never the reverse.
- ESLint enforces the domain boundary: `src/domain/**` cannot import `src/db`, `src/calendar`, `src/app`, `next` or `@supabase/*`. `src/domain/boundary.test.ts` proves the rule fails when violated.
- Nothing reaches a calendar before Approval. A Recommendation is never edited; the user's choices live on the Task. Level 2/3 Evidence levels never render as Manufacturer verified.
- Tests sit next to the code (`*.test.ts`). Component tests use React Testing Library with `// @vitest-environment jsdom`.
- Config: copy `.env.example` to `.env.local`; `.env*` is gitignored.
- CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → test → build on every PR.
