# Invited testers: AI label reading

AI label reading costs money per photo, so on public deployments it is limited to invited testers (docs/HANDOFF.md §23). Everyone can always type the details instead.

## How it is enforced

- `/api/identify` reserves one **billable attempt** in Supabase (`reserve_scan`) before every provider request. If the answer is not `allowed`, it returns 403 and calls nothing.
- Limits per UTC day, in `public.scan_limits`: **5 per tester** and **100 in total** (defaults). The day's total row is locked for each reservation, so simultaneous scans cannot exceed either limit (concurrency test in `src/app/lib/supabase-plan-repository.integration.test.ts`).
- Attempts are never given back: a failed or timed-out provider call may still be billed, so it still counts.
- Counts belong to the Keeply user and the day. Revoking and re-inviting the same account or starting new anonymous sessions never resets a count. Deleting an account deletes its invite and its own counts; using AI again then needs a new invite from the owner, and the day's total (the spending ceiling) is never lowered.
- Visitors cannot read invites, change limits or counters, or create invites (pgTAP `supabase/tests/database/scan_invites.test.sql`).
- Fails closed: without Supabase, without a session, or on any error, no AI call is made and the visitor gets the manual form.
- `KEEPLY_SCAN_ACCESS=open` lifts the invite check for a private machine or a login-protected preview only. It is ignored when `VERCEL_ENV=production`.
- Scanning also needs `NEXT_PUBLIC_KEEPLY_SCAN=1` and a provider key (`MINIMAX_API_KEY`). Without both, `/appliances/scan` and `/api/identify` return 404 or Manual, whatever the invites.

## Operator tasks (Supabase SQL Editor)

Create an invite (the code is shown once; only its hash is stored). Use a non-personal note:

```sql
select public.create_scan_invite('Tester 1');
```

Send the tester the link `https://<site>/invite?code=<code>`. They open it and tap **Accept invite**. It binds to their Keeply account; signing in with Google first keeps it across devices.

See invites and today's use:

```sql
select note, redeemed_by is not null as used, revoked_at, created_at from public.scan_invites order by created_at;
select * from public.scan_daily_totals order by day desc limit 7;
select user_id, scans from public.scan_usage where day = (now() at time zone 'utc')::date;
```

Revoke (takes effect on the next scan):

```sql
update public.scan_invites set revoked_at = now() where note = 'Tester 1';
```

Change the limits (for example, pause all AI scans with `global_daily = 0`):

```sql
update public.scan_limits set per_tester_daily = 5, global_daily = 100;
```

## Before inviting anyone

AI for other people needs a key whose terms allow serving other users. MiniMax describes its Token Plan as being for individual, interactive developer use and recommends pay-as-you-go for production. It also needs spending controls on that key. See `docs/live-gates.md` G7.
