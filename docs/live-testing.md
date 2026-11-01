# Live testing label scanning

How the owner tests photo → AI proposal → Confirm / Edit / Rescan with a real OpenRouter key, privately. Nothing here deploys publicly or serves other people without invite limits.

## What is wired today (RF-357)

| Part | State |
|---|---|
| Scan UI, `/api/identify`, OpenRouter adapter, Manual fallback | Real. Scanning is off unless `NEXT_PUBLIC_KEEPLY_SCAN=1` is set at build time; AI is off unless `OPENROUTER_API_KEY` is set on the server. |
| Storage | Supabase when configured (MVP schema, anonymous sign-ins); device `localStorage` locally unless `.env.local` sets the Supabase values. Record checks in `docs/live-gates.md`. |
| Accounts | Anonymous Supabase sign-in when Supabase is configured; optional Google sign-in needs the provider enabled. With device storage there is no account. |
| Google Calendar | Needs `GOOGLE_*` in `.env.local` or your host env; verify calendar write on your deployment. |
| Hosted preview | Use a protection-gated preview URL when testing AI against a remote build. |
| Plan proposer | `scripts/live-plan-check.mjs` can drive plan search on a hosted URL: manual add → `/api/plan` → plan page with source, page and quote → Accept / Reject → Approve → Google Calendar. |

Historical MiniMax live notes: `docs/ai/minimax.md`.

## Option A (recommended): private test on your Mac

1. Create `.env.local` in the repo root (gitignored) containing `OPENROUTER_API_KEY=` followed by your key. Type it in a text editor; never paste it into chat or a commit.
2. Run `scripts/live-test.sh`, then open http://localhost:3000/appliances/scan.
   - Add `--lan` to open it from your phone on the same Wi-Fi: the script prints `http://<mac-ip>:3000/appliances/scan`. While it runs, anyone on that network could use your quota, so stop it (Ctrl+C) when done.
   - Without a key it still runs, in Manual mode.

Data stays in that browser's storage. Calendar writes need the `GOOGLE_*` values (see `README.md`) and are not needed to test scanning.

## Option B: private Vercel preview

1. Settings → Deployment Protection: keep **Vercel Authentication** on for previews, so only you, signed in to Vercel, can open them.
2. Settings → Environment Variables, scoped to **Preview** only: `NEXT_PUBLIC_KEEPLY_SCAN=1`, `OPENROUTER_API_KEY` (marked Sensitive), optionally `OPENROUTER_MODEL=openrouter/free`. Leave Production without them if scanning is not yet public.
3. Remove leftover `MINIMAX_*` and `KEEPLY_AI_KEY_ENCRYPTION_KEY` from Preview once RF-357 is deployed.
4. Redeploy the preview and open its URL while signed in to Vercel.

`/api/identify` has no rate limit of its own beyond the Supabase scan reservation; Deployment Protection is what keeps others off your quota on a private preview. Do not turn protection off.

## What to try

1. A clear photo of the rating plate. Check each proposed field against the plate, especially look-alike characters (V/Y, 0/O, 1/I, 5/S, 8/B). Then Confirm.
2. The same plate again: Edit a field, then Confirm. An edited record keeps no AI confidence.
3. A photo of the whole appliance with no plate visible. Expect the neutral "could not read a label" message and the manual form, with nothing invented. For non-dishwasher appliances the manual form is the only path: Keeply does not invent tasks when no manufacturer manual was found.
4. A blurry or very dark plate, then Rescan.
5. Confirm → plan search: a found manufacturer manual should show evidence-labelled tasks with page and quote; Approve only after Accept / Reject; Calendar writes only after Approval.
6. Reload the page: the appliance stays on Home.

If OpenRouter is unavailable, the app takes the honest Manual / `ai_unavailable` path.
