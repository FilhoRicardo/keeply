# Keeply

PPM for your home: scan what you own, understand how to maintain it, and keep it working for longer.

**Licence:** [MIT](LICENSE). **Self-host:** step-by-step setup in [`docs/self-host.md`](docs/self-host.md). **Contributing:** [`CONTRIBUTING.md`](CONTRIBUTING.md). **Security:** [`SECURITY.md`](SECURITY.md). Managed hosting from the project maintainers is planned for later; this repository is for running Keeply yourself.

Status: MVP flow built (`docs/HANDOFF.md` §24): any household appliance (label photo → AI proposal → Confirm / Edit / Rescan, or typed) → proposed plan → Accept / Reject each task → Approval → accepted tasks become recurring Google Calendar events, managed there. Dishwashers fall back to a hand-curated general-guidance list when no manual is found; every other appliance needs a found manual or the plan is honestly empty (no plan). Manual search finds the manufacturer's own manual (Brave Search), reads it with the AI, and shows each task with its page and verbatim quote. Scanning and search sit behind `NEXT_PUBLIC_KEEPLY_SCAN=1`, `OPENROUTER_API_KEY` (sole AI provider; Manual when unset) and `BRAVE_SEARCH_API_KEY` (all server-side). Plan: `docs/HANDOFF.md`. How work is run: `AGENTS.md`. Module layout: `docs/architecture.md`.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000; plans are stored in the browser until Supabase is configured
```

Copy `.env.example` to `.env.local` to turn on Supabase and Google Calendar. Without them the full flow works on the device and approval saves the plan locally.

Live test of label scanning with a real AI key, privately: `docs/live-testing.md` (`scripts/live-test.sh`). Where each setting lives (`.env.local` / Vercel / Supabase / Google Cloud, names only): `docs/environments.md`.

## Checks

| Command | What it covers |
|---|---|
| `pnpm verify` | typecheck, lint, unit and component tests, production build |
| `pnpm build && pnpm e2e` | The MVP walkthrough on a phone viewport, with axe accessibility checks |
| `PGURL=… scripts/db-test.sh` | pgTAP schema rules on a fresh Postgres (same files as `supabase test db`) |
| `PGURL=… scripts/db-integration.sh` | supabase-js → PostgREST → Postgres with RLS, plus the calendar route |

CI runs all four on every pull request. Contributors need no repository secrets; see [`docs/ci.md`](docs/ci.md).

## Deploy

Production setup (Supabase, Google OAuth, env vars, Vercel or Node): [`docs/self-host.md`](docs/self-host.md).

## Rules that the code enforces

- AI label reading on public deployments is for anyone signed in with Google, and for an anonymous session that has redeemed an invite. Each scan reserves one billable attempt in Supabase first (limits live in Supabase `scan_limits`: 10 per person and 12 non-owner scans per UTC day; the owner's unlimited invite is recorded and does not use the shared cap; `docs/testers.md`). Refusals call nothing.

- Nothing reaches a calendar before Approval; rejected tasks never do. Approval needs every task decided and one accepted.
- A proposed task is never rewritten (database trigger); the owner only accepts or rejects it.
- Manufacturer verified needs a linked, quoted manufacturer document (database check); general and similar-model guidance never read as verified.
- Every task has a source; every row is scoped to its owner by RLS. Label photos are not stored.
