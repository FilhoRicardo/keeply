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
| G4 Usage counts | 2026-10-04 | Supabase (owner's browser): 11 `funnel_events`: manual flow `appliance_added` (`scanned:false`), `plan_proposed` (3, verified 0), `calendar_connected`, `plan_approved` (accepted 1, rejected 2), `calendar_tasks_created` (1); hosted scans `scan_started`, `label_read` (`recognised:true`), `appliance_added` (`scanned:true`), `plan_proposed` (3, 0), `scan_started`, `label_read` (`recognised:false`). Props hold counts and booleans only. Events are fire-and-forget, so two sent together can land in either order. Same check also showed the confirmed BUSH row (`e8dd832b…`, BUSH / WV9-6S / 150804092, confidence 0.95, not approved) with its 3 tasks, owned by the same user as Bosch. |
| G5 Sign in with Google | 2026-10-04 | Google client has the Supabase `auth/v1/callback`; Supabase: Google provider enabled, Manual linking on, preview root allowlisted, Site URL saved. Owner signed in with Google and kept Bosch and BUSH under the original user `2f2ccb25-b8c6-47a5-8ec6-b9b0cdb54433` (anonymous account linked, not replaced). Sign out → empty Home. Signing in again from a new anonymous session showed "Switch to that account" (no merge); switching restored exactly Bosch and BUSH. |
| G3 Isolation between visitors | 2026-10-04 | Signed out (new anonymous visitor): Home empty; `/appliances/e8dd832b…` (BUSH) → "We could not find that dishwasher". That visitor created "Isolation test" `fa413a76-2f25-406f-9e81-05420f747e63` under a different user `d2a286d0-7a5e-4f44-b258-7e7f5b31445d` (checked in Supabase). Back as the owner, the Isolation test URL was also denied. |

## Open (not yet verified live)

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

### G7 Invited testers (not started)

Everything above is proven on the owner-only, login-protected preview. For invited testers, in order:

1. **Owner decision: merge PR #4.** Production then deploys from `main`; Vercel's Standard Protection does not cover the production domain, so it is public.
2. **Production configuration (owner):** add `https://<production-domain>/auth/google/callback` to the Google client; set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (that URI) for **Production**; in Supabase URL Configuration set the Site URL to the production domain and allowlist it. The Supabase variables are already set for Production.
3. **Production smoke test (owner, no AI):** manual add → accept/reject → approve → one Calendar event; Google sign-in. Scanning stays off in Production.
4. **Testers' Google accounts:** the Google app is in Testing, so each tester's Gmail must be added as a test user (up to 100) before they can sign in or connect a calendar. They will see Google's "unverified app" screen.
5. **Testers use manual entry until AI for testers is ready.** Scanning for others needs all of: a pay-as-you-go MiniMax key (the Token Plan is for individual use; owner cost decision), MiniMax spend limits, and the §23 invite code with 5 per tester and 100 per day caps (agreed scope, not built). Until then Production keeps `NEXT_PUBLIC_KEEPLY_SCAN` unset.
6. **The plan is still general guidance.** Finding the manufacturer's manual (Phase 3, §23: Brave Search + MiniMax reading the manual, verified only with a code-checked quote) is not built; it needs a Brave Search API key (owner) and the same AI-for-testers decisions as scanning.
7. Optional: G6 failure paths; delete the test rows (Bosch, BUSH, Isolation test); remove the preview's MiniMax variables when private testing ends.
