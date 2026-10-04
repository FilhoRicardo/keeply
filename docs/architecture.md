# Architecture

Next.js (App Router) + TypeScript `strict`, pnpm, ESLint, Vitest. Verify with `pnpm verify`.

| Module | Holds | May import |
|---|---|---|
| `src/domain/` | Pure plan logic, no IO: Recommendation → Task decisions, Approval rules, interval → recurrence mapping. Most tests live here. | itself only |
| `src/db/` | Supabase client and queries. The only module that talks to Postgres. | `domain` |
| `src/calendar/` | Google Calendar adapter behind a small `CalendarWriter` interface (shape comes from the KEE-4 spike). | `domain` |
| `src/app/` | Routes and UI only. Calls domain, db and calendar; holds no business rules. | all of the above |

## Rules

- Dependencies point inward: `app` → `db` / `calendar` → `domain`. Never the reverse.
- ESLint enforces the domain boundary: `src/domain/**` cannot import `src/db`, `src/calendar`, `src/app`, `next` or `@supabase/*`. `src/domain/boundary.test.ts` proves the rule fails when violated.
- Nothing reaches a calendar before Approval. A Recommendation is never edited; the user's choices live on the Task. Level 2/3 Evidence levels never render as Manufacturer verified.
- Tests sit next to the code (`*.test.ts`). Component tests use React Testing Library with `// @vitest-environment jsdom`.
- Config: copy `.env.example` to `.env.local`; `.env*` is gitignored.
- CI (`.github/workflows/ci.yml`) runs install → typecheck → lint → test → build on every PR.
