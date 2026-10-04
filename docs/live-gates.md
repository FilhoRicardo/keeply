# Live gates for the MVP (docs/HANDOFF.md §24)

What has been checked on the real services, with evidence, and what is still open. Automated checks (unit, pgTAP, PostgREST integration, phone e2e) run in CI on every push; this file is only about the hosted setup.

Environment under test: Vercel Preview of branch `claude/dazzling-mayer-ytyahw` (commit 25f5900), Supabase project `xmilbvzbptmozwjphvsx`, Google Cloud project "Keeply" (OAuth client "Keeply preview", External, Testing, owner Gmail as the only test user). Photo scanning off; no maintenance-plan AI.

## Passed

| Gate | Date | Evidence (verified in the owner's browser by Codex) |
|---|---|---|
| G0 Database setup | 2026-10-04 | MVP schema applied (reset + migration in the SQL Editor). Vercel Preview + Production hold `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| G1 Anonymous session and persistence | 2026-10-04 | First attempt failed with "Anonymous sign-ins are disabled"; owner enabled them. Manual Bosch add then reached the three-task plan; `appliances` had the Bosch row and `maintenance_tasks` exactly 3 linked rows (general guidance, proposed); both survived a reload. |
| G2 Approval → Google Calendar | 2026-10-04 | `GOOGLE_*` saved for Preview only (secret values never in chat); redeploy Ready; owner completed OAuth. Bosch appliance `09e14405-9f89-4ea9-b260-d246efde2661` approved with "Clean the filter" accepted, the other two rejected. Keeply showed "Plan approved" and the task as Added. Google Calendar shows one all-day event "Clean the filter · Bosch dishwasher" on 4 Oct 2026, monthly on day 4, with instructions, the general-guidance source and the approval line. In `maintenance_tasks` the accepted task has `calendar_event_id` `kp6163…3131` (Keeply's deterministic id); both rejected tasks are NULL. |

## Open (not yet verified live)

### G3 Isolation between visitors (owner, about 2 minutes)

RLS is tested in CI (pgTAP and PostgREST integration); this confirms it on the hosted project.

1. Open the preview in a private/incognito window (a new anonymous visitor). Home must say "No appliances yet."
2. In that window open `/appliances/09e14405-9f89-4ea9-b260-d246efde2661`. It must say "We could not find that dishwasher."
3. In that window add a dishwasher "Isolation test". Then in the Supabase SQL Editor run
   `select user_id, manufacturer from public.appliances order by created_at;`
   The Bosch and "Isolation test" rows must have different `user_id`s.
4. Back in the first browser, Home must still list only Bosch.

### G4 Usage counts (owner, 1 minute)

In the SQL Editor: `select name, props, occurred_at from public.funnel_events order by occurred_at;`
Expected from G1–G2: `appliance_added`, `plan_proposed` (`tasks: 3, verified: 0`), `calendar_connected`, `plan_approved` (`accepted: 1, rejected: 2`), `calendar_tasks_created` (`count: 1`). No names, models or dates in `props`.

### G5 Sign in with Google (account identity; separate from Calendar)

Not configured yet: the button is visible but fails until these owner steps are done.

1. Google Cloud → the same OAuth client "Keeply preview" → add Authorized redirect URI `https://xmilbvzbptmozwjphvsx.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Sign In / Providers → **Google**: enable, paste the client ID and secret (owner, directly).
3. Supabase → Authentication → Sign In / Providers: turn on **Allow manual linking** (lets an anonymous visitor keep their plans when they sign in).
4. Supabase → Authentication → URL Configuration: Site URL = the preview URL for now; Redirect URLs: add `https://keeply-git-claude-dazzling-mayer-ytyahw-filhoricardos-projects.vercel.app/**`.
5. Test, in the browser that owns Bosch:
   - Home → **Sign in with Google** → consent → back on Home with "Signed in as <gmail>" and Bosch still listed.
   - SQL: `select id, is_anonymous, email from auth.users;` the Bosch owner's id is unchanged and now `is_anonymous = false`.
   - **Sign out** → Home is empty (new anonymous visitor). **Sign in with Google** → "That Google account already has Keeply plans. Switch to it?" → **Switch to that account** → Bosch is back.

### G6 Failure paths (optional live; covered by automated tests)

- Decline the calendar permission on Google's screen → Keeply says nothing was added and still allows Approval.
- After about an hour the Google token expires: the app asks to reconnect; **Add N tasks to Google Calendar** on the dishwasher page retries without duplicating.

### G8 AI label reading, owner-only on the hosted preview

Verified in a cloud session (not hosted) on 2026-10-04: MiniMax-M3 with this Token Plan key reads the owner's real BUSH plate exactly through the full app path after the JPEG-quality fix (`docs/ai/minimax.md`). Hosted scanning is off. To test it on the preview, owner only:

1. Vercel → Settings → **Deployment Protection**: confirm Vercel Authentication covers Preview deployments, so only the owner's Vercel login can reach the preview (and its `/api/identify`).
2. MiniMax → Billing: confirm no purchased Credits or auto top-up, so usage stops at the Token Plan quota (5-hour and weekly windows) instead of spending money.
3. Vercel → Environment Variables, **Preview only**: `MINIMAX_API_KEY` (Secret; the Token Plan `sk-cp-…` key, entered by the owner), `MINIMAX_MODEL=MiniMax-M3`, `NEXT_PUBLIC_KEEPLY_SCAN=1`. Redeploy (the scan flag is read at build time).
4. Test on the phone: Home → **Scan appliance** → photograph the BUSH plate → expect BUSH / WV9-6S / 150804092 → Confirm → plan. Also a photo of the whole dishwasher → "could not read" + manual form.
5. Turn it off again by removing `NEXT_PUBLIC_KEEPLY_SCAN` (and the key) and redeploying, unless the owner keeps it for private use.

Before invited users: the owner reviews MiniMax's terms for serving other people with a Token Plan key (the official docs found describe quota and coverage, not end-user use), and the §23 invite code plus 5-per-tester / 100-per-day caps are built; none of that exists yet.

### G7 Production and testers (owner decisions)

- Merge PR #4 → production deploys from `main`. Then: add `https://<production-domain>/auth/google/callback` to the Google client, set the three `GOOGLE_*` for **Production** with that redirect URI, add the production URL to Supabase redirect URLs, and repeat G1–G2 there.
- Vercel protects Preview URLs by default, so testers should use the production URL.
- In Testing mode only listed Google test users can connect a calendar or sign in: add each tester's Gmail (up to 100).
