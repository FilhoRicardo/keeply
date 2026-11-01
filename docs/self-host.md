# Self-host Keeply

Production setup covers Supabase (migrations and auth providers), a Google Cloud OAuth client for Calendar, environment variables on Vercel or Node, and optional AI/search keys. A fuller walkthrough is planned in OSS-04; this page keeps README links working and lists the essentials.

## Supabase

1. Create a project and note `<your-project-ref>`.
2. Run everything under `supabase/migrations/` (`supabase db push`, or paste into the SQL Editor).
3. Enable **Anonymous sign-ins** under Authentication → Sign In / Providers.
4. Optional **Google** provider: use an OAuth client whose redirect URI is `https://<your-project-ref>.supabase.co/auth/v1/callback`, and enable **Manual linking** so anonymous visitors keep their plans when they sign in.
5. Set **Site URL** and **Redirect URLs** to match your deployed domain (and preview URL if you use one).

## Google Calendar OAuth

1. Enable the Calendar API and configure the OAuth consent screen.
2. Create a Web OAuth client with redirect URI `https://<your-domain>/auth/google/callback` (Calendar scope: `calendar.events` only). This client is separate from the Supabase Google login client.

## Environment variables

Copy `.env.example` to `.env.local` for local runs. On Vercel or your host, set the same names listed in [`docs/environments.md`](environments.md) (values never belong in git).

Minimum for a hosted MVP: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`. For scanning and manual search also set `NEXT_PUBLIC_KEEPLY_SCAN=1`, `OPENROUTER_API_KEY` (and optionally `OPENROUTER_MODEL=openrouter/free`), `BRAVE_SEARCH_API_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` (Brave quota accounting).

Remove retired MiniMax settings if they are still present (`MINIMAX_*`, `KEEPLY_AI_KEY_ENCRYPTION_KEY`).

## Verify your deployment

Use [`docs/live-gates.md`](live-gates.md) as a checklist and [`docs/live-testing.md`](live-testing.md) for scripted label-scan checks.
