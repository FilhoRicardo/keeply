# Live testing label scanning

How to test photo → AI proposal → Confirm / Edit / Rescan with OpenRouter, privately. Nothing here deploys publicly. Historical MiniMax checks are in `docs/ai/minimax.md` (retired, RF-357).

## What is wired

| Part | State |
|---|---|
| Scan UI, `/api/identify`, OpenRouter adapter, Manual fallback | Real. Scanning is off unless `NEXT_PUBLIC_KEEPLY_SCAN=1` is set at build time. AI is off unless `OPENROUTER_API_KEY` is set on the server. A MiniMax key is ignored. |
| Manual extraction | The same OpenRouter key, through `/api/plan`. A provider failure is `extraction_unavailable`, not a second provider. |
| Storage | Supabase on the Vercel deployments; device `localStorage` locally unless `.env.local` sets the Supabase values. Live status: `docs/live-gates.md`. |
| Google Calendar | Configured for Vercel Preview and verified live (`docs/live-gates.md` G2). Locally it needs `GOOGLE_*` in `.env.local`. |
| Plan proposer | `scripts/live-plan-check.mjs` drives the G10 plan-search gate on a real Preview. |

## Private test on your machine

1. Put `OPENROUTER_API_KEY=` and `NEXT_PUBLIC_KEEPLY_SCAN=1` in `.env.local` (gitignored). Type the key in a text editor; never paste it into chat or a commit.
2. Run `scripts/live-test.sh`, then open http://localhost:3000/appliances/scan.
   - Add `--lan` to open it from your phone on the same Wi-Fi. Anyone on that network could use the OpenRouter quota while it runs, so stop it (Ctrl+C) when done.
   - Without a key it still runs, in Manual mode.

## Protected Vercel preview

1. Keep Deployment Protection on for previews.
2. Set Preview variables only: `NEXT_PUBLIC_KEEPLY_SCAN=1`, `OPENROUTER_API_KEY` (Sensitive), `OPENROUTER_MODEL=openrouter/free`, plus the Supabase and Brave values the plan search needs. Leave Production unchanged unless Ricardo approves a production change.
3. Redeploy that preview and open it while signed in to Vercel.

Do not record the key, the photo bytes, or the raw provider body. Record the model, the outcome, and any limit the preview reports.

## What to try

1. A clear photo of a rating plate. Check each proposed field against the plate, especially look-alike characters (V/Y, 0/O, 1/I, 5/S, 8/B). Then Confirm.
2. The same plate again: Edit a field, then Confirm. An edited record keeps no AI confidence.
3. A photo of the whole appliance with no plate visible. Expect the neutral "could not read a label" message and the manual form, with nothing invented.
4. A blurry or very dark plate, then Rescan.
5. Reload the page: the appliance stays on Home.

If OpenRouter fails, the confirm screen says label reading is unavailable and the manual form remains. The response does not include the provider body.
