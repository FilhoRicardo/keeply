# Live gates for the MVP (docs/HANDOFF.md §24)

What has been checked on the real services, with evidence, and what is still open. Automated checks (unit, pgTAP, PostgREST integration, phone e2e) run in CI on every push; this file is only about the hosted setup.

Environment under test: Vercel Preview of branch `claude/dazzling-mayer-ytyahw` (commit 25f5900), Supabase project `xmilbvzbptmozwjphvsx`, Google Cloud project "Keeply" (OAuth client "Keeply preview", External, Testing, owner Gmail as the only test user). Photo scanning off; no maintenance-plan AI.

## Passed

| Gate | Date | Evidence (verified in the owner's browser by Codex) |
|---|---|---|
| G0 Database setup | 2026-10-04 | MVP schema applied (reset + migration in the SQL Editor). Vercel Preview + Production hold `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. |
| G1 Anonymous session and persistence | 2026-10-04 | First attempt failed with "Anonymous sign-ins are disabled"; owner enabled them. Manual Bosch add then reached the three-task plan; `appliances` had the Bosch row and `maintenance_tasks` exactly 3 linked rows (general guidance, proposed); both survived a reload. |
| G2 Approval → Google Calendar | 2026-10-04 | `GOOGLE_*` saved for Preview only (secret values never in chat); redeploy Ready; owner completed OAuth. Bosch appliance `09e14405-9f89-4ea9-b260-d246efde2661` approved with "Clean the filter" accepted, the other two rejected. Keeply showed "Plan approved" and the task as Added. Google Calendar shows one all-day event "Clean the filter · Bosch dishwasher" on 4 Oct 2026, monthly on day 4, with instructions, the general-guidance source and the approval line. In `maintenance_tasks` the accepted task has `calendar_event_id` `kp6163…3131` (Keeply's deterministic id); both rejected tasks are NULL. |

| G8 AI label reading on the hosted preview (owner only) | 2026-10-04 | Preview of `e529dd4` rebuilt with branch-scoped Preview variables (`MINIMAX_API_KEY` Secret, `MINIMAX_MODEL=MiniMax-M3`, `NEXT_PUBLIC_KEEPLY_SCAN=1`); Deployment Protection: Standard, Require Log In, no exceptions. Exactly two uploads in the owner's browser: (1) the real BUSH plate → confirm screen Dishwasher / BUSH / WV9-6S / 150804092 with the look-alike reminder and Confirm / Edit / Rescan; nothing saved until the owner pressed Confirm; saved appliance `e8dd832b-5ff0-47d8-a6d5-eeeb4ed57927` and opened its plan with 3 undecided general-guidance tasks. (2) A real photo of a whole dishwasher with no readable label → the neutral "could not read a dishwasher label" message and a blank manual form; no identity invented; not saved. Production and invited-user scanning stay off. |

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

Google provider enabled in Supabase with the client ID and secret (2026-10-04). Still to confirm: the Supabase callback URI on the Google client, Manual linking, the URL configuration, then the test.

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

Verified in a cloud session on 2026-10-04 (not on Vercel): MiniMax-M3 with the owner's Token Plan key reads the real BUSH plate exactly through the full app path after the JPEG-quality fix (`docs/ai/minimax.md`). Hosted scanning is off.

**Gate when scanning is off** (checked locally on a production build, 2026-10-04): `GET /appliances/scan` → 404, Home has no Scan button, `POST /api/identify` → 404 `not_enabled` even with `MINIMAX_API_KEY` set, and no provider call is made (also a unit test). The page reads the flag at build time and the API at runtime, so always **redeploy** after changing the flag: on Vercel both then see the same value.

**Token Plan for this use** (MiniMax's own docs, read through search excerpts because the docs host is blocked from the session): the Token Plan "is designed for individual, interactive developer use" and MiniMax recommends pay-as-you-go for production, switching by replacing the Subscription Key with a standard Open Platform API key ([Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq), [Token Plan overview](https://platform.minimax.io/docs/token-plan/intro)). Keys must not be shared or exposed client-side. So: an owner-only test behind Vercel's login fits the Token Plan; invited testers are production use and should run on a pay-as-you-go key (no code change: same endpoint, only the key differs), with the §23 invite code and caps in place.

**Configuration, owner only:**

1. Vercel → Settings → Deployment Protection: Vercel Authentication on for Preview. Check: open `https://keeply-git-claude-dazzling-mayer-ytyahw-filhoricardos-projects.vercel.app/api/identify` in a private window that is not signed in to Vercel. Expected: Vercel's login page. If it shows JSON instead, the preview is public: stop here.
2. MiniMax → Billing: no purchased Credits and no auto top-up, so use stops at the Token Plan quota.
3. Vercel → Settings → Environment Variables. For each: environment **Preview** only, Git branch **`claude/dazzling-mayer-ytyahw`** only:
   - `MINIMAX_API_KEY` = the Token Plan key (`sk-cp-…`), marked **Sensitive**, typed or pasted by the owner;
   - `MINIMAX_MODEL` = `MiniMax-M3`;
   - `NEXT_PUBLIC_KEEPLY_SCAN` = `1`.
   Do not set `MINIMAX_BASE_URL` (the default `https://api.minimax.io/v1` is right). Then redeploy the latest deployment of that branch.

**Hosted test (exactly two MiniMax calls):**

1. Phone, signed in to Vercel: Home shows **Scan appliance**. Photograph (or choose) the BUSH plate. Expected: Dishwasher / BUSH / WV9-6S / 150804092 with the look-alike reminder; compare with the plate; **Confirm**; the plan opens with 3 tasks.
2. Scan again with a photo of the whole dishwasher (no plate). Expected: "Keeply could not read a dishwasher label in this photo…" and the manual form, nothing proposed. Go back without saving.
3. Supabase: `select manufacturer, model, serial_number, identification_confidence from public.appliances order by created_at desc limit 1;` → BUSH / WV9-6S / 150804092 with a confidence; `select name, props from public.funnel_events order by occurred_at desc limit 6;` → `scan_started`, `label_read` (`recognised: true`, then `false`), `appliance_added` (`scanned: true`), `plan_proposed`.
4. Production has no flag: its `/appliances/scan` stays 404.
5. Afterwards, unless kept for private use: delete the three variables and redeploy.

### G7 Production and testers (owner decisions)

- Merge PR #4 → production deploys from `main`. Then: add `https://<production-domain>/auth/google/callback` to the Google client, set the three `GOOGLE_*` for **Production** with that redirect URI, add the production URL to Supabase redirect URLs, and repeat G1–G2 there.
- Vercel protects Preview URLs by default, so testers should use the production URL.
- In Testing mode only listed Google test users can connect a calendar or sign in: add each tester's Gmail (up to 100).
