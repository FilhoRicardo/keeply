# Keeply

PPM for your home: scan what you own, understand how to maintain it, and keep it working for longer.

Status: Phase 0 + 1 built (manual dishwasher → proposed plan → Include / Customise / Skip → approval → Google Calendar). Phase 2 label scanning (photo → AI proposal via MiniMax, or Manual → Confirm / Edit / Rescan) sits behind `NEXT_PUBLIC_KEEPLY_SCAN=1` and a server-side `MINIMAX_API_KEY`. Plan: `docs/HANDOFF.md`. How work is run: `AGENTS.md`. Module layout: `docs/architecture.md`.

## Run it

```bash
pnpm install
pnpm dev            # http://localhost:3000; plans are stored in the browser until Supabase is configured
```

Copy `.env.example` to `.env.local` to turn on Supabase and Google Calendar. Without them the full flow works on the device and approval saves the plan locally.

Live test of label scanning with a real AI key, privately: `docs/live-testing.md` (`scripts/live-test.sh`).

## Checks

| Command | What it covers |
|---|---|
| `pnpm verify` | typecheck, lint, unit and component tests, production build |
| `pnpm build && pnpm e2e` | Phase 1 walkthrough on a phone viewport, with axe accessibility checks |
| `PGURL=… scripts/db-test.sh` | pgTAP schema rules on a fresh Postgres (same files as `supabase test db`) |
| `PGURL=… scripts/db-integration.sh` | supabase-js → PostgREST → Postgres with RLS, plus the calendar route |

CI runs all four on every pull request.

## Go live

1. Supabase (`xmilbvzbptmozwjphvsx`): `supabase link --project-ref xmilbvzbptmozwjphvsx && supabase db push`, then enable **Anonymous sign-ins**.
2. Google Cloud: enable the Calendar API, configure the consent screen, create a Web OAuth client with redirect URI `https://<your-domain>/auth/google/callback`. Scope used: `calendar.events` only. Keeply talks to Google Calendar directly with this client; the Supabase Google provider (step 3) is only for signing in.
3. Sign in with Google (optional, recommended): in Supabase → Authentication → Sign In / Providers enable **Google** (a Google OAuth client whose redirect URI is `https://xmilbvzbptmozwjphvsx.supabase.co/auth/v1/callback`) and **Manual linking** (anonymous visitors keep their plans when they sign in). Add the site URL under URL Configuration → Redirect URLs. This login is separate from the calendar consent in step 2.
4. Vercel: set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. The service-role key is not used by the app.

## Rules that the code enforces

- Nothing reaches a calendar before Approval; skipped tasks never do.
- A Recommendation is never rewritten (database trigger); the owner's schedule lives on the Task.
- General and similar-model guidance never reads as manufacturer verified.
- Every Recommendation has a source; every row is scoped to its owner by RLS.
