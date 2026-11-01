# Continuous integration

GitHub Actions runs on every pull request and on pushes to `main`. **Contributors do not need repository secrets** for the main CI workflow (`.github/workflows/ci.yml`): verify, database tests, and e2e all pass with only the checkout and Node/pnpm setup.

## Jobs

| Job | What it does | Secrets |
|---|---|---|
| `verify` | `pnpm typecheck`, `lint`, `test`, `build` | none |
| `database` | Ephemeral Postgres 16, pgTAP schema tests, PostgREST integration | none (`PGURL` is set in the workflow) |
| `e2e` | Production build + Playwright phone walkthrough | none |

### E2e without real API keys

Playwright starts a dedicated Next server with `KEEPLY_E2E_FIXTURES=1` (see `playwright.config.ts`). Placeholder env values stand in for OpenRouter, Brave, and Google; outbound calls are answered from fixtures under `e2e/fixtures`. No `OPENROUTER_API_KEY`, `BRAVE_SEARCH_API_KEY`, or live Google OAuth is required in CI.

## Optional workflows

| Workflow | Secrets |
|---|---|
| `.github/workflows/supabase-keepalive.yml` | Optional `SUPABASE_URL` and `SUPABASE_ANON_KEY` for the maintainer's hosted project only; skipped when unset |
| `.github/workflows/gitleaks.yml` | Uses the default `GITHUB_TOKEN` only; scans the PR for accidental secret commits |

## Running locally

Same as CI:

```bash
pnpm verify
pnpm build && pnpm e2e
PGURL=postgres://postgres:postgres@localhost:5432/postgres scripts/db-test.sh   # needs local Postgres + pgTAP
```
