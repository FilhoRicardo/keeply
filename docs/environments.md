# Where Keeply settings live (local vs production)

A new developer can use this page to see, in one place, which setting goes
where: a developer-only `.env.local`, the Vercel project, the Supabase
project, or the Google Cloud OAuth client. The list is **names**, never
values — read `.env.example` for the values, the README deploy list (or `docs/self-host.md`) for production
setup, and `docs/live-gates.md` as an operator checklist template.

If a setting is not in this table, it is either a constant in the code
(for example, the OpenRouter model default) or an OAuth-screen configuration in Google
Cloud / Supabase, which the README's "Go live" list covers step by step.
Do not invent a new location; add it here first.

## Settings by location

| Setting | Where it lives | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `.env.local` / Vercel | no (public anon URL) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `.env.local` / Vercel | no (anon key; RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.local` / Vercel | **yes** (server only; bypasses RLS; also needed for the durable Brave quota) |
| `GOOGLE_CLIENT_ID` | `.env.local` / Vercel | no (public OAuth client id) |
| `GOOGLE_CLIENT_SECRET` | `.env.local` / Vercel | **yes** (server only) |
| `GOOGLE_REDIRECT_URI` | `.env.local` / Vercel | no (registered URI, not a secret) |
| `NEXT_PUBLIC_KEEPLY_SCAN` | `.env.local` / Vercel | no (build-time feature flag; "1" enables) |
| `BRAVE_SEARCH_API_KEY` | `.env.local` / Vercel | **yes** (server only) |
| `BRAVE_FREE_QUOTA_PER_MONTH` | `.env.local` / Vercel | no (counter cap; override only for self-hosted tests) |
| `OPENROUTER_API_KEY` | `.env.local` / Vercel | **yes** (server only; never `NEXT_PUBLIC_*`). Sole AI provider (RF-357). |
| `OPENROUTER_MODEL` | `.env.local` / Vercel | no (defaults to `openrouter/free`) |
| `OPENROUTER_DATA_COLLECTION` | `.env.local` / Vercel (optional) | no (`deny` default; `allow` opts in to providers that may train on prompts) |
| `KEEPLY_SCAN_ACCESS` | `.env.local` / Vercel | no (scan-access mode; "invite" is the safe default) |
| `KEEPLY_E2E_FIXTURES` | Playwright scan server only (`.env.local` if you run that server yourself) | no (`1` serves canned OpenRouter, Brave, manual and Google responses). Ignored on every Vercel deployment (production and preview). Do not set it on Vercel. |

### Local development (`.env.local`)

Copy `.env.example` to `.env.local` and fill in the values for the parts
of the app you want to exercise. Anything that is **server only** (no
`NEXT_PUBLIC_` prefix, and used in `src/ai/`, `src/search/`, `src/db/`,
or `src/calendar/`) stays on the disk and is never bundled to the
browser.

Local-only defaults: leave `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` unset and plans are stored in the
browser on the device (`README.md` "Run it"); leave `GOOGLE_CLIENT_ID`
/ `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` unset and Approval
saves the plan locally without writing to a calendar.

### Vercel (Production / Preview)

The same names, set in **Vercel → Project → Settings → Environment
Variables**. Anything without `NEXT_PUBLIC_` must be added without the
prefix (Vercel never exposes a server-only variable to the browser).
Sensitive values (`SUPABASE_SERVICE_ROLE_KEY`,
`GOOGLE_CLIENT_SECRET`,
`BRAVE_SEARCH_API_KEY`, `OPENROUTER_API_KEY`) are entered as **Sensitive**
and are never pasted into chat or committed.

`KEEPLY_E2E_FIXTURES` is not a Vercel setting. Production ignores it, and setting it
on a preview would answer AI, search and Calendar from fixtures. Leave it unset.

Two Vercel-specific behaviours to remember:

- `NEXT_PUBLIC_KEEPLY_SCAN` is read at **build time**, so changing it
  on Production or Preview requires a redeploy for the new value to
  take effect after redeploy.
- The scan flag is read at build time by the page and at runtime by
  the API; if they disagree, the API wins. The Preview / Production
  environment variables must therefore match on the same deployment.

### Supabase (your project)

Supabase holds no Keeply env-var settings. The settings that live there
are configured through the Supabase dashboard (see README "Go live"):

| Setting | Where | Notes |
|---|---|---|
| Anonymous sign-ins | Supabase → Authentication → Sign In / Providers | Required for the MVP without sign-in (G1) |
| Google provider | Supabase → Authentication → Sign In / Providers → Google | OAuth client whose redirect URI is `https://<project>.supabase.co/auth/v1/callback` |
| Manual linking | Supabase → Authentication → Sign In / Providers | Anonymous visitors keep their plans when they sign in |
| Site URL / Redirect URLs | Supabase → Authentication → URL Configuration | The site URL must match the deployed domain; add the preview and production domains |

Schema, RLS, the invites table and the scan-access tables all live in
Supabase but are code (`supabase/migrations/`), not settings.

### GitHub Actions (Supabase keep-alive)

Supabase may pause a free-tier project after a period without database
activity. `.github/workflows/supabase-keepalive.yml`
runs every 3 days (and on demand from the Actions tab). It makes one
anonymous read, `GET /rest/v1/appliances?select=id&limit=1`. Postgres runs
the query, and RLS returns an empty list because anon can see no rows. It
adds no grants or schema and does not use the service-role key.

| Setting | Where | Secret? |
|---|---|---|
| `SUPABASE_URL` | GitHub → repo → Settings → Secrets and variables → Actions | no (same value as `NEXT_PUBLIC_SUPABASE_URL`) |
| `SUPABASE_ANON_KEY` | GitHub → repo → Settings → Secrets and variables → Actions | no (same value as `NEXT_PUBLIC_SUPABASE_ANON_KEY`; kept as a secret so it stays out of logs) |

If either secret is missing, the run logs a notice and passes without
calling Supabase. A non-2xx reply or a network failure fails the run, so
a red run usually means the project is paused. Resume it in the Supabase
dashboard. After adding the secrets, run the workflow once by hand to
check it.

This only lowers the risk. Supabase may still pause the project if it
changes its inactivity policy. GitHub also disables scheduled workflows
after 60 days without repository activity; re-enable it from the Actions
tab if that happens.

### Google Cloud (Keeply OAuth client)

| Setting | Where | Notes |
|---|---|---|
| Calendar API enabled | Google Cloud → APIs & Services → Library | Required for the MVP write |
| OAuth consent screen | Google Cloud → APIs & Services → OAuth consent screen | External, in Testing mode: only listed test users can connect |
| OAuth client "Keeply" | Google Cloud → APIs & Services → Credentials | Web client; redirect URI `https://<your-domain>/auth/google/callback` |
| Test users | Google Cloud → Auth Platform → Audience | Up to 100 invited testers (G7) |

The Supabase Google provider (above) uses a **second** OAuth client
whose redirect URI is the Supabase `auth/v1/callback`; the two clients
are not the same and the redirect URIs must not be mixed.

## How to read this against `.env.example` and the README

Every name in `.env.example` is in the table above; the order matches.
Two names appear in the README "Go live" list that are not env vars and
are therefore listed in the Supabase / Google Cloud sections instead:

- **Anonymous sign-ins** in Supabase → Authentication (no env name).
- **Google OAuth client + redirect URI** in Google Cloud (no env name;
  only `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
  `GOOGLE_REDIRECT_URI` are env names).

If you change a location for any setting, update this file in the same
PR. New env vars land in `.env.example` first, then in this table.

## Retired MiniMax settings (RF-357; owner cleanup after merge)

The app no longer reads these. After this PR merges and production is
authorized, remove them from Vercel Production and Preview and redeploy.
Apply migration `20261031120000_drop_ai_credentials.sql` through the
normal reviewed Supabase path; do not leave `ai_credentials` populated.

| Name | Where it may still live | Owner action after approval |
|---|---|---|
| `MINIMAX_API_KEY`, `MINIMAX_MODEL`, `MINIMAX_BASE_URL` | Vercel, if previously set | Remove from Production and Preview |
| `KEEPLY_AI_KEY_ENCRYPTION_KEY` | Vercel, if previously set | Remove from Production and Preview |
| `public.ai_credentials` | Supabase | Apply the drop-table migration after review |
