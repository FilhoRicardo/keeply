# Keeply

Keep what you own working for longer. Keeply is a mobile-first web app for household appliance maintenance: identify an appliance, review evidence-labelled recommendations, and send only the tasks you accept to Google Calendar.

**Free, open-source software under the [MIT licence](LICENSE).** You can use, modify, and self-host Keeply. Hosting and optional third-party APIs may have their own costs; free software does not mean every service is free. Managed hosting from the project maintainers is planned for later, not available through this repository today.

## Why I'm building Keeply

I'm Ricardo Filho. My professional background in ESG (environmental, social, and governance) shapes why I'm building Keeply: I want to help people keep things running longer instead of replacing them. Making everyday maintenance easier is a practical place to start.

Longer term, I'd like an item's maintenance history to travel with it when it is sold, helping the next owner understand how it has been cared for. The idea is inspired by the EU building passport concept. This is a vision, not a shipped feature or a claim of regulatory compliance. Keeply does not currently track maintenance completion or transfer maintenance histories.

## What works today

The MVP supports any household appliance:

1. Type the appliance details, or photograph its label when AI scanning is configured. Confirm, edit, or rescan the proposed identity.
2. Review a proposed maintenance plan. When configured, manufacturer manual search uses Brave Search and AI extraction to show recommendations with their source page and verbatim quote.
3. Accept or reject each task. Source recommendations are not rewritten.
4. Give explicit Approval to send accepted tasks to Google Calendar as recurring events. Manage them there afterward; Keeply does not track completion or reschedule tasks.

Manufacturer-verified, similar-model, and general guidance remain visibly distinct. Without a manufacturer manual, only dishwashers have a built-in, hand-curated general-guidance fallback. Other appliances have no plan rather than invented maintenance advice.

## Try it locally

Use **Node.js 24** (the version used in CI) and **pnpm 12.9.1** (pinned in `package.json`). From your local checkout:

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000. No API keys are needed to explore the manual-entry path. Without Supabase configuration, plans stay in the browser on that device; without Google configuration, Approval saves locally and does not write calendar events. Without search and AI credentials, manuals cannot be fetched and extracted, so the dishwasher fallback is the available starting point for a plan.

### Connect services and self-host

Copy [`.env.example`](.env.example) to `.env.local` and follow the [self-hosting guide](docs/self-host.md) for setup:

- **Supabase:** account authentication and database persistence.
- **Google OAuth and Calendar:** calendar writes after Approval. Calendar access and Supabase Google sign-in use two separate OAuth clients; the guide explains both.
- **OpenRouter (optional):** label-photo identification and manual PDF extraction. It is the current AI provider; typed entry remains available without it.
- **Brave Search (optional):** automatic manufacturer manual search.

Set `NEXT_PUBLIC_KEEPLY_SCAN=1` at build time to enable the scan UI. Keep `OPENROUTER_API_KEY` and `BRAVE_SEARCH_API_KEY` server-side; never give them a `NEXT_PUBLIC_` prefix. Public deployments also enforce scan access and usage limits; see [tester access](docs/testers.md).

The self-hosting guide covers deployment to Vercel or a Node host. See [environment settings](docs/environments.md) for where each setting belongs, and [private live testing](docs/live-testing.md) for scanning with real credentials. Do not commit `.env.local` or secrets.

## Checks

| Command | What it covers |
|---|---|
| `pnpm verify` | typecheck, lint, unit and component tests, production build |
| `pnpm build && pnpm e2e` | The MVP walkthrough on a phone viewport, with axe accessibility checks |
| `PGURL=… scripts/db-test.sh` | pgTAP schema rules on a fresh Postgres (same files as `supabase test db`) |
| `PGURL=… scripts/db-integration.sh` | supabase-js → PostgREST → Postgres with RLS, plus the calendar route |

CI runs all four on every pull request. Browser tests also need Chromium installed with `pnpm exec playwright install chromium`; database checks need the services and tools described in [the CI guide](docs/ci.md). Contributors need no repository secrets.

## Get involved

You're welcome to try Keeply, report a problem, improve the docs, or contribute code. Start with [Contributing](CONTRIBUTING.md) for setup and pull-request expectations. For security concerns, follow the [Security policy](SECURITY.md).

Start with the [documentation index](docs/README.md). For deeper context, see the [product decisions and MVP scope](docs/HANDOFF.md), [module architecture](docs/architecture.md), and [agent workflow](AGENTS.md).

## Rules that the code enforces

- AI label reading on public deployments is for anyone signed in with Google, and for an anonymous session that has redeemed an invite. Each scan reserves one billable attempt in Supabase first (limits live in Supabase `scan_limits`: 10 per person and 12 non-owner scans per UTC day; the owner's unlimited invite is recorded and does not use the shared cap; `docs/testers.md`). Refusals call nothing.

- Nothing reaches a calendar before Approval; rejected tasks never do. Approval needs every task decided and one accepted.
- A proposed task is never rewritten (database trigger); the owner only accepts or rejects it.
- Manufacturer verified needs a linked, quoted manufacturer document (database check); general and similar-model guidance never read as verified.
- Every task has a source; every row is scoped to its owner by RLS. Label photos are not stored.
