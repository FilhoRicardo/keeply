# AI label reading

Anyone signed in to Keeply with Google can use AI label reading and manual reading, up to **10 scans per UTC day**. All non-owner scans together are capped at **12 per UTC day**. The owner stays unlimited. A visitor who is not signed in can always type the details, and can still use an invite code for that anonymous session.

Google’s own test-user list is the gate for who can sign in. Invite codes are only for anonymous sessions.

## How it is enforced

- `/api/identify` and `/api/plan` reserve one **billable attempt** in Supabase (`reserve_scan`) before every provider request. If the answer is not `allowed`, they return 403 and call nothing.
- A caller may reserve when either they are signed in and not anonymous (`auth.jwt() ->> 'is_anonymous'` is not `true`), or they have a redeemed, unrevoked invite.
- Limits per UTC day, in `public.scan_limits`: **`per_tester_daily = 10`** and **`global_daily = 12`**. The shared cap counts non-owner scans only. The day’s total row is locked for each reservation, so simultaneous scans cannot exceed it (concurrency test in `src/app/lib/supabase-plan-repository.integration.test.ts`).
- `public.scan_daily_totals` is that shared cap. An unlimited account’s scans are still recorded on `public.scan_usage` and are not added to the daily total.
- Attempts are never given back: a failed or timed-out provider call may still be billed, so it still counts.
- Counts belong to the Keeply user and the day. Revoking and re-inviting the same anonymous account, or starting a new anonymous session, never resets a count. Deleting an account deletes its invite and its own counts. The day’s total is never lowered.
- A Google sign-in is reported as status `invited` (the caller may scan). That is the same value the scan screen already understands, so the previous app keeps working after this migration and before the new copy is deployed.
- Visitors cannot read invites, change limits or counters, or create invites (pgTAP `supabase/tests/database/scan_invites.test.sql` and `scan_google_access.test.sql`).
- Fails closed: without Supabase, without a session, or on any error, no AI call is made and the visitor gets the manual form.
- `KEEPLY_SCAN_ACCESS=open` lifts the check for a private machine or a login-protected preview only. It is ignored when `VERCEL_ENV=production`.
- Scanning also needs `NEXT_PUBLIC_KEEPLY_SCAN=1` and a provider key. Without both, `/appliances/scan` and `/api/identify` return 404 or Manual.

## Operator tasks (Supabase SQL Editor)

Google sign-in does not need a code. Create an invite only for an anonymous session, or for your own unlimited flag. The code is shown once; only its hash is stored. Use a non-personal note:

```sql
select public.create_scan_invite('Tester 1');
```

Send the link `https://<site>/invite?code=<code>`. They open it and tap **Accept invite**. It binds to that Keeply account. Signing in with Google does not need this step.

See invites and today's use. The daily total is non-owner scans only; each person’s own row includes the owner:

```sql
select note, redeemed_by is not null as used, unlimited, revoked_at, created_at from public.scan_invites order by created_at;
select * from public.scan_daily_totals order by day desc limit 7;
select user_id, scans from public.scan_usage where day = (now() at time zone 'utc')::date;
```

Revoke an anonymous invite (takes effect on the next scan; a Google sign-in is unaffected):

```sql
update public.scan_invites set revoked_at = now() where note = 'Tester 1';
```

Change the limits (for example, pause non-owner AI scans with `global_daily = 0`):

```sql
update public.scan_limits set per_tester_daily = 10, global_daily = 12;
```

Make your own account unlimited (no per-person or shared ceiling; its scans are still recorded and do not use the shared cap). Create an invite with the note `Owner`, redeem it from your own signed-in account, then:

```sql
update public.scan_invites set unlimited = true where note = 'Owner';
```

Only the owner can set this flag; visitors cannot read or change invites. Remove it with `set unlimited = false`.

## Before serving other people

AI for other people needs a key whose terms allow serving other users, and spending controls on that key. See `docs/live-gates.md` G7. OpenRouter is the sole AI provider (RF-357); Manual always works when it is unset.
