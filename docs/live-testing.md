# Live testing label scanning

How the owner tests photo → AI proposal → Confirm / Edit / Rescan with a real MiniMax key, privately. Nothing here deploys publicly or serves other people (the Token Plan terms for that are unconfirmed, see `docs/ai/minimax.md`).

## What is wired today (audit, 2026-10-04)

| Part | State |
|---|---|
| Scan UI, `/api/identify`, MiniMax adapter, Manual fallback | Real. Verified live with MiniMax-M3 (see `docs/ai/minimax.md`). Scanning is off unless `NEXT_PUBLIC_KEEPLY_SCAN=1` is set at build time; AI is off unless `MINIMAX_API_KEY` is set on the server. |
| Storage | Device (browser `localStorage`) unless `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set. The Supabase adapter, migrations and anonymous sign-in are built and tested against local Postgres in CI, but the hosted project has not had `supabase db push` and is not configured in any deployment. |
| Accounts | Anonymous Supabase sign-in when Supabase is configured; optional Google sign-in needs the provider enabled. With device storage there is no account. |
| Google Calendar | Built; needs a Google OAuth client (`GOOGLE_*`). Without it, approval saves on the device only. |
| Vercel | No deployment configuration in the repo and no recorded deployment. This work lives on branch `claude/dazzling-mayer-ytyahw`, which is not merged into `main`. |
| Claude cloud sessions | Can reach MiniMax through the proxy-injected credential (test relay `scripts/minimax-proxy-relay.mjs`), but cannot give the owner a URL to open. They are for automated checks only. |

## Option A (recommended): private test on your Mac

Uses your own key on your own machine, which is personal use of your Token Plan.

1. Get the branch: `git fetch origin && git checkout claude/dazzling-mayer-ytyahw && git pull`.
2. Create `.env.local` in the repo root (gitignored) containing one line, `MINIMAX_API_KEY=` followed by your key. Type it in a text editor; never paste it into chat or a commit.
3. Run `scripts/live-test.sh`, then open http://localhost:3000/appliances/scan.
   - Add `--lan` to open it from your phone on the same Wi-Fi: the script prints `http://<mac-ip>:3000/appliances/scan`. While it runs, anyone on that network could use your quota, so stop it (Ctrl+C) when done.
   - Add `--check` to first send one test image straight to MiniMax (`pnpm verify:minimax`).
   - Without a key it still runs, in Manual mode.

Data stays in that browser's storage. Calendar writes need the `GOOGLE_*` values (see `README.md`) and are not needed to test scanning.

## Option B: private Vercel preview (if you want a link on the phone without the Mac)

Prepared, not done: these steps put your key on Vercel, so they are yours to take.

1. Vercel → Add New Project → import `FilhoRicardo/keeply` (framework Next.js, defaults).
2. Settings → Deployment Protection: keep **Vercel Authentication** on for previews, so only you, signed in to Vercel, can open them.
3. Settings → Environment Variables, scoped to **Preview** only: `NEXT_PUBLIC_KEEPLY_SCAN=1`, `MINIMAX_API_KEY` (marked Sensitive), `MINIMAX_MODEL=MiniMax-M3`. Leave Production without them.
4. Redeploy the `claude/dazzling-mayer-ytyahw` preview and open its URL while signed in to Vercel.

`/api/identify` has no rate limit of its own; Deployment Protection is what keeps others off your quota. Do not add these variables to Production or turn protection off.

## What to try

1. A clear photo of the rating plate. Check each proposed field against the plate, especially look-alike characters (V/Y, 0/O, 1/I, 5/S, 8/B). Then Confirm.
2. The same plate again: Edit a field, then Confirm. An edited record keeps no AI confidence.
3. A photo of the whole dishwasher with no plate visible. Expect the neutral "could not read a dishwasher label" message and the manual form, with nothing invented.
4. A blurry or very dark plate, then Rescan.
5. Reload the page: the appliance stays on Home.

If something goes wrong, the server logs `[identify] minimax failed: …` and the app falls back to the manual form.
