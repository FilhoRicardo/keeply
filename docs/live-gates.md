# Live gates for the MVP (docs/HANDOFF.md §24)

What has been checked on the real services, with evidence, and what is still open. Automated checks (unit, pgTAP, PostgREST integration, phone e2e) run in CI on every push; this file is only about the hosted setup.

Environment under test: Vercel Preview of branch `kee-44-p3-7-live-gates` (off `main` at KEE-43 / `47c1661`), Supabase project `xmilbvzbptmozwjphvsx`, Google Cloud project "Keeply" (OAuth client "Keeply preview", External, Testing, owner Gmail as the only test user). Preview is gated by Vercel Authentication; only the owner opens it. `NEXT_PUBLIC_KEEPLY_SCAN=1`, `MINIMAX_API_KEY`, `MINIMAX_MODEL=MiniMax-M3`, `BRAVE_SEARCH_API_KEY` set on the Preview; Production stays off. Photo scanning + plan search are live on the Preview for G8 and G10.

Prior gates in this file (G0–G9) were verified on the older `claude/dazzling-mayer-ytyahw` branch (commit 25f5900). G10 is the first gate to run on the new `kee-44-p3-7-live-gates` Preview and so it is the first one to exercise the post-KEE-43 plan proposer end to end on real dishwashers.

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

### G10 Plan proposer on real dishwashers (hosted preview)

Wave-2 verification of the post-KEE-43 plan search: photo or manual add → `/api/plan` → a plan where each task shows its source, page and (for Manufacturer verified) a code-checked quote → Accept / Reject → Approval → Google Calendar. Five cases the issue requires plus the calendar-write case, all on the hosted Preview. Defects discovered here are filed as new `KEE-…` issues; nothing is fixed silently in this branch.

**What gets recorded per case** (one row per case; the table below is filled by `scripts/live-plan-check.mjs`, which writes `<label>-result.json` next to the screenshots and a `<label>-row.json` for the table):

| Field | Source | What it proves |
|---|---|---|
| `case` | harness arg | The scenario being driven. |
| `query` (manufacturer, model) | manual form input | The owner typed this. |
| `appliance_id` | local storage or Supabase row | The appliance the plan belongs to. |
| `chosen_source` (`url`, `title`) | `/api/plan` `proposals[].source` | The document the proposer picked. |
| `extracted_tasks` (name, evidence_level) | `/api/plan` `proposals[]` | What came out of the AI extraction. |
| `quote_check` (pass / fail / n/a) | `src/domain/evidence-check.ts` `verifyQuote` on the page text | The model is not the source of the interval: the code, not the model, must find the quote in the document text. |
| `fallback` | `/api/plan` `fallback` (`exact` / `similar` / `general`) | The classification survives the route. |
| `search_outcome` | `/api/plan` `searchOutcome` | The honest reason when no verified plan is found (`ok`, `no_results`, `quota_exhausted`, `fetch_failed`, `extraction_unavailable`, `unreadable`, `no_text`, `timeout`, `unavailable`). |
| `time_to_plan_ms` | harness (form submit → "Review each task" rendered) | The magic minute. Target ≤ 60 000 ms end to end. |
| `calendar_event_id` (after Approval) | Supabase `maintenance_tasks.calendar_event_id` for the accepted task | Nothing reaches a calendar before Approval. |

**Harness and how to run it (owner / CTO):**

```bash
# On the host, with a session cookie / signed-in to Vercel Authentication and the owner's .env.local
# MINIMAX_API_KEY / BRAVE_SEARCH_API_KEY either in the Preview env or local .env.local, and a Supabase
# session for the owner (the harness reuses the same localStorage / Supabase adapter as the app):
node scripts/live-plan-check.mjs <base-url> <out-dir> --case <name> \
    --manufacturer "Electrolux" --model "KEQB7300L" \
    [--defect KEE-XX] [--note "free-text note"]
# `--case` is one of: exact-manual, similar-only, no-manual, scanned-pdf, brave-fail, minimax-fail,
# calendar-write. The harness writes <out-dir>/<case>-result.json (browser steps + /api/plan
# response + screenshots) and <out-dir>/<case>-row.json (the single row to paste into the G10
# table below). When the runner observes a defect, they file a KEE-… issue, then re-run with
# `--defect KEE-XX --note "what you saw"`. The harness writes the id and the note into both
# result.json and row.json so the row's `defect` column fills the table.
```

**Cases (the five the issue names plus the calendar-write case):**

1. **Exact manual found, Manufacturer verified.** A model with the manufacturer's own PDF on its own domain (e.g. Electrolux `KEQB7300L` — Ricardo's `test-photos/dishwasher.jpg` reads the plate to that model). Expect: at least one task with `evidenceLevel: manufacturer_verified`, a link to the manufacturer's own PDF/HTML on the manufacturer's own domain, a `page N` location, a verbatim quote, and `quote_check: pass`. The `fallback` is `exact` and `search_outcome` is `ok`. The trust line on the plan page says "Manufacturer verified"; the "Why? / View source" panel shows the link, page and quote. Photo: `docs/screenshots/g10-1-exact.png`.
2. **Similar-model only.** A model whose manual is not on the manufacturer's own domain but whose product-family manual is (e.g. an Electrolux model in the same family as `KEQB7300L` but with no standalone manual). Expect: tasks at `evidenceLevel: similar_model` with the same source panel and quote, `fallback: similar`, `search_outcome: ok`, no task rendered as Manufacturer verified. Photo: `docs/screenshots/g10-2-similar.png`.
3. **No manual found (general guidance).** A model with no manufacturer manual on the first Brave page (e.g. an obscure OEM model number or a typo the search returns empty for). Expect: `proposals` is the three general-guidance tasks, every `evidenceLevel` is `general_guidance`, `fallback: general`, `search_outcome: no_results` (or `fetch_failed` when a candidate was found but could not be read), and the plan page shows the "we did not find a manual" fallback banner. No source link, no quote, no Manufacturer verified. Photo: `docs/screenshots/g10-3-general.png`.
4. **Scanned-image PDF.** A real manufacturer manual that is a scanned image (no embedded text layer). Expect: `/api/plan` returns `search_outcome: unreadable` for that document, the proposer tries the next Brave candidate, and the final plan is whatever the next candidate yielded — most likely general guidance if no other candidate is readable. The point is that scanned PDFs never silently become verified. Photo: `docs/screenshots/g10-4-scanned.png`.
5. **Brave fails.** Run the exact-manual case with `BRAVE_SEARCH_API_KEY` removed from the Preview env (or set to a wrong value). Expect: `/api/plan` returns `searchOutcome: no_results` with `searchReason: no_key` (or Brave's HTTP error), `fallback: general`, the three general-guidance tasks, and the plan page shows the fallback banner. No provider call is made. Photo: `docs/screenshots/g10-5-brave-fail.png`.
6. **MiniMax fails.** Run the exact-manual case with `MINIMAX_API_KEY` removed (or set to a wrong value) but `BRAVE_SEARCH_API_KEY` still set. Expect: Brave finds the manual and the document is read, but the extraction returns `'unavailable'`, so `search_outcome: extraction_unavailable` and `fallback: general`. No partial "Manufacturer verified" task is returned. Photo: `docs/screenshots/g10-6-minimax-fail.png`.
7. **Calendar write after Approval (runs on the case 1 appliance).** Accept one task, reject the others, set a start date, click Approve. Expect: Keeply shows "Plan approved", the accepted task's `calendar_event_id` in Supabase is the deterministic `kp…` id, the rejected tasks' `calendar_event_id` is NULL, and Google Calendar shows one recurring all-day event from the start date with instructions, the source and the approval line. Photo: `docs/screenshots/g10-7-calendar.png`.

**Pass criteria (the gate is "passed" when all of the following hold):**

- The 6 rows above (cases 1–6) are filled; the calendar-write row (case 7) names the event id and Google Calendar URL.
- Every Manufacturer verified task has `quote_check: pass`; the code, not the model, found the quote in the document text. Any `quote_check: fail` is a defect.
- No task with `evidenceLevel` `similar_model` or `general_guidance` ever renders as "Manufacturer verified" in any screenshot. (Three evidence levels stay visibly distinct — non-negotiable #2.)
- `time_to_plan_ms` ≤ 60 000 for every case that did not fail; failed cases are excluded from the time target and recorded with the failure reason.
- Nothing reached Google Calendar before the Approve click. The `calendar_event_id` is set only after Approval and only for the accepted task. (Non-negotiable #1.)
- At least one defect discovered during the run is filed as a new `KEE-…` issue; the table links to it. (No silent fixes.)
- The CFO cost note (search calls per plan, AI calls per plan, estimated cost per plan from the plan's `BRAVE_FREE_QUOTA_PER_MONTH` + MiniMax Token Plan / pay-as-you-go rates) is filed in a sibling `KEE-…` issue or attached to this gate.

**Filled table (filled by the harness after the CTO opens the Preview and the owner runs the script):**

The rows below are the runner's deliverable, not this branch's. The branch (KEE-44, this gate) ships the spec, the harness (`scripts/live-plan-check.mjs`), the read-only `/api/g10/calendar-event` route, the row schema (`src/app/lib/live-plan-row.ts` mirrored in `scripts/g10-row.mjs`), the unit + cross-check tests, and the pass criteria. Filling the seven rows (including the calendar-write case) needs (a) a hosted Preview URL — the [Environment under test](#live-gates-for-the-mvp-docshandoffmd-24) paragraph names the branch that opens it — (b) the runner driving the harness on the owner's browser with a Supabase session, and (c) the runner re-pasting `<out-dir>/<case>-row.json` into the table. Ricardo's `test-photos/` directory plus a real phone run fill case 1 (the KEQB7300L photo) and the CFO note; cases 2–7 are the runner's and a follow-up PR's work.

| # | Case | Manufacturer / model | chosen_source.title | chosen_source.url | extracted_tasks (name, level) | quote_check | fallback | search_outcome | time_to_plan_ms | calendar_event_id | defect |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | exact-manual | _Electrolux / KEQB7300L_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _exact_ | _ok_ | _TBD_ | _n/a (case 7)_ | _—_ |
| 2 | similar-only | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _similar_ | _ok_ | _TBD_ | n/a | _—_ |
| 3 | no-manual | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _n/a_ | _general_ | _no_results_ | _TBD_ | n/a | _—_ |
| 4 | scanned-pdf | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _general_ | _unreadable_ | _TBD_ | n/a | _—_ |
| 5 | brave-fail | _Electrolux / KEQB7300L_ (no key) | _TBD_ | _TBD_ | _TBD_ | _n/a_ | _general_ | _no_results_ | _TBD_ | n/a | _—_ |
| 6 | minimax-fail | _Electrolux / KEQB7300L_ (no key) | _TBD_ | _TBD_ | _TBD_ | _TBD_ | _general_ | _extraction_unavailable_ | _TBD_ | n/a | _—_ |
| 7 | calendar-write | case-1 appliance | — | — | — | — | — | — | — | _TBD_ | _—_ |

## Open (not yet verified live)

### G6 Failure paths (optional live; covered by automated tests)

- Decline the calendar permission on Google's screen → Keeply says nothing was added and still allows Approval.
- After about an hour the Google token expires: the app asks to reconnect; **Add N tasks to Google Calendar** on the dishwasher page retries without duplicating.

### G8 AI label reading, owner-only on the hosted preview (passed; setup reference)

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

### G9 Invites and scan limits (built 2026-10-05; live check pending)

Server-enforced invites and limits (`docs/testers.md`): 56 pgTAP checks (including grants, re-invite, account deletion), a PostgREST concurrency test (12 simultaneous scans → exactly 5 allowed per tester and exactly the daily remainder), route tests proving refusals make no provider call, and an e2e check that scanning stays shut by default. Not yet verified on the hosted stack.

1. **Apply the migration (Codex, SQL Editor):** run `supabase/migrations/20261005100000_scan_invites.sql` once. It only adds tables and functions; the existing rows are untouched.
2. **Preview is now invite-only:** the preview has no `KEEPLY_SCAN_ACCESS`, so the owner needs an invite there too. Create one: `select public.create_scan_invite('Owner');`. Signed in as the owner on the preview, open `/invite?code=<code>` → **Accept invite** → "Invite accepted".
3. **Live checks (one MiniMax call in total):**
   - Private window on the preview (a new anonymous visitor, no invite): Scan shows "AI label reading is for invited testers…"; photograph anything → "AI label reading is for invited testers, so the photo was not sent to the AI service" and the manual form. Vercel logs show no `[identify] minimax` line for it.
   - Owner (invited): Scan shows "AI label reading: 5 scans left today." One BUSH scan → the same proposal as before; the note then says 4 left.
   - SQL: `select * from public.scan_daily_totals;` → 1 for today; `select name, props from public.funnel_events order by occurred_at desc limit 4;` → `invite_redeemed`, `scan_denied` (`no_invite`), `scan_started`, `label_read`.
4. Rollback for this step only: `update public.scan_limits set global_daily = 0;` stops all AI scans at once without a deploy.

### G7 Invited testers

The invite limits (G9) are built. For a public test round, in order:

1. **Merge PR #4** (authorised; done once CI and review pass). Production then deploys from `main`. Vercel Standard Protection does not cover the production domain, so it is public. Production has no `NEXT_PUBLIC_KEEPLY_SCAN` and no MiniMax key: scanning stays off there (scan page and `/api/identify` 404).
2. **Production configuration (Codex in the browser; owner enters secrets):**
   - Note the production domain from Vercel → Project → Domains (shown below as `<prod>`).
   - Google Cloud → the OAuth client: add redirect URIs `https://<prod>/auth/google/callback`. The Supabase callback is already there.
   - Vercel → Environment Variables, **Production**: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (the same values as Preview; owner enters them), and `GOOGLE_REDIRECT_URI` = `https://<prod>/auth/google/callback`. Redeploy production.
   - Supabase → Authentication → URL Configuration: Site URL `https://<prod>`; add `https://<prod>` to Redirect URLs (keep the preview entry). Without this, Google sign-in on production returns to the preview.
3. **Production smoke test (no AI):** manual add → accept 1, reject 2 → connect Calendar → approve → one monthly event; Google sign-in keeps the dishwasher; `/appliances/scan` is 404.
4. **Testers:** add each tester's Gmail as a Google test user (Google Auth Platform → Audience; up to 100). Send them the production link. They type their dishwasher's details.
5. **AI for testers (optional, owner decision):** needs a pay-as-you-go MiniMax key (not the Token Plan key, which stays Preview-only) with spending limits set in MiniMax. Then in Vercel **Production**: `MINIMAX_API_KEY` (Sensitive), `MINIMAX_MODEL=MiniMax-M3`, `NEXT_PUBLIC_KEEPLY_SCAN=1`; redeploy; create one invite per tester (`docs/testers.md`). Never set `KEEPLY_SCAN_ACCESS` in Production (it is ignored there anyway).
6. Optional: G6 failure paths; delete the test rows (Bosch, BUSH, Isolation test).

**Rollback:** Vercel → Deployments → the previous production deployment → **Promote to Production** (instant). Code: revert the merge commit on `main`. AI only: remove `NEXT_PUBLIC_KEEPLY_SCAN` from Production and redeploy, or `update public.scan_limits set global_daily = 0;` (immediate). Database: the migrations only add objects; nothing needs undoing to roll the app back.
