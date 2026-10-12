-- Run with `supabase test db` (or scripts/db-test.sh). Invites and server-enforced scan limits.
-- Invariants: billable attempts never exceed the per-tester and daily limits; nobody but the owner
-- can create invites, read them or change counters and limits; revoking, re-inviting, new anonymous
-- sessions and account deletion never reset a tester's count or the day's total.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(42);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d4', 'owner@example.com'),
  ('00000000-0000-0000-0000-0000000000a1', 'tester-a@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'tester-b@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'no-invite@example.com');

-- These callers are anonymous sessions (is_anonymous true). A Google sign-in is covered in
-- scan_google_access.test.sql; without this claim the migration would treat them as signed in.
create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', true)::text,
    true
  );
  set local role authenticated;
$$;
create function pg_temp.as_owner() returns void language sql as $$
  reset role;
  select set_config('request.jwt.claims', '', true);
$$;

-- The owner creates invites; codes have the documented shape and are stored only as hashes.
update scan_limits set per_tester_daily = 2, global_daily = 3;
create temp table codes (note text, code text);
insert into codes values ('A', create_scan_invite('Tester A')), ('B', create_scan_invite('Tester B')),
  ('B2', create_scan_invite('Tester B again')), ('C', create_scan_invite('Tester C'));
grant select on codes to authenticated, anon;
select ok((select bool_and(code ~ '^KP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$') from codes), 'codes look like KP-XXXX-XXXX-XXXX-XXXX');
select is((select count(*) from scan_invites where code_hash in (select code from codes)), 0::bigint, 'plain codes are never stored');

-- Nobody but the owner manages invites, counters or limits.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select create_scan_invite('mine') $$, '42501', null, 'visitors cannot create invites');
select throws_ok($$ select * from scan_invites $$, '42501', null, 'visitors cannot read invites');
select throws_ok($$ update scan_invites set revoked_at = null $$, '42501', null, 'visitors cannot un-revoke invites');
select throws_ok($$ update scan_usage set scans = 0 $$, '42501', null, 'visitors cannot reset their usage');
select throws_ok($$ delete from scan_daily_totals $$, '42501', null, 'visitors cannot reset the daily total');
select throws_ok($$ update scan_limits set per_tester_daily = 99 $$, '42501', null, 'visitors cannot change limits');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like '%scan%' and p.proname not in
     ('scan_invite_status', 'redeem_scan_invite', 'scan_allowance', 'reserve_scan', 'create_scan_invite')),
  0::bigint, 'no other scan function exists (in particular nothing that gives scans back)');

reset role;
set local role anon;
select throws_ok($$ select reserve_scan() $$, '42501', null, 'signed-out callers cannot reserve');
select throws_ok($$ select redeem_scan_invite('x') $$, '42501', null, 'signed-out callers cannot redeem');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select is(scan_invite_status(), 'no_invite', 'no invite yet');
select is(reserve_scan(), 'no_invite', 'no scan without an invite');
select is(redeem_scan_invite('KP-0000-0000-0000-0000'), 'invalid', 'an unknown code is refused');
select is(redeem_scan_invite(lower(replace((select code from codes where note = 'A'), '-', ''))), 'invited', 'a valid code is redeemed; case and dashes do not matter');
select is(redeem_scan_invite((select code from codes where note = 'C')), 'already_invited', 'one live invite per person');

-- Per-tester ceiling (2).
select is(reserve_scan(), 'allowed', 'first attempt');
select is(reserve_scan(), 'allowed', 'second attempt');
select is(reserve_scan(), 'tester_limit', 'third attempt is over the tester limit');
select is((scan_allowance() ->> 'tester_left')::int, 0, 'allowance shows nothing left for this tester');

-- A used code cannot be redeemed by another account (e.g. a fresh anonymous session).
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select is(redeem_scan_invite((select code from codes where note = 'A')), 'invalid', 'a redeemed code cannot be reused');

-- Daily ceiling (3): tester B gets one attempt, then the day is full for everyone.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select is(redeem_scan_invite((select code from codes where note = 'B')), 'invited', 'second tester redeems');
select is(reserve_scan(), 'allowed', 'daily attempt 3 of 3');
select is(reserve_scan(), 'daily_limit', 'the daily total is reached');
select is((scan_allowance() ->> 'global_left')::int, 0, 'allowance shows the day is full');

-- Revoking stops a tester at once; re-inviting the same account does not reset its count.
select pg_temp.as_owner();
update scan_limits set global_daily = 10;
update scan_invites set revoked_at = now() where redeemed_by = '00000000-0000-0000-0000-0000000000b2';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2');
select is(reserve_scan(), 'no_invite', 'a revoked invite allows nothing');
select is(redeem_scan_invite((select code from codes where note = 'B2')), 'invited', 'a revoked tester can be given a new invite');
select is(reserve_scan(), 'allowed', 'the re-invited tester continues from the same count (2nd of 2)');
select is(reserve_scan(), 'tester_limit', 'and re-inviting did not reset the count');

-- Deleting an account removes its invite (the code stays used) and never lowers the day's total.
select pg_temp.as_owner();
delete from auth.users where id = '00000000-0000-0000-0000-0000000000a1';
select is((select count(*) from scan_invites where note = 'Tester A'), 0::bigint, 'the deleted account''s invite is gone');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select is(redeem_scan_invite((select code from codes where note = 'A')), 'invalid', 'its code cannot be redeemed again');
-- Without a limits row, nobody is allowed (fail closed).
select pg_temp.as_owner();
create temp table saved_limits as select * from scan_limits;
delete from scan_limits;
update scan_invites set revoked_at = null, redeemed_by = '00000000-0000-0000-0000-0000000000c3' where note = 'Tester C';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3');
select is(reserve_scan(), 'daily_limit', 'an invited tester gets nothing when the limits row is missing');
select pg_temp.as_owner();
insert into scan_limits select * from saved_limits;

select pg_temp.as_owner();
select is((select scans from scan_daily_totals), 4, 'the day''s total still counts every attempt (A 2, B 2)');
select is((select count(*) from scan_usage where user_id = '00000000-0000-0000-0000-0000000000b2'), 1::bigint, 'one usage row per tester and day');
select is((select scans from scan_usage where user_id = '00000000-0000-0000-0000-0000000000b2'), 2, 'tester B made exactly two attempts');

-- The owner's own account can be made unlimited: no per-tester or daily ceiling, still counted.
select pg_temp.as_owner();
update scan_limits set per_tester_daily = 1, global_daily = 5;
create temp table owner_code as select create_scan_invite('Owner') as code;
grant select on owner_code to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select throws_ok($$ update scan_invites set unlimited = true $$, '42501', null, 'visitors cannot make themselves unlimited');
select is(redeem_scan_invite((select code from owner_code)), 'invited', 'the owner redeems their invite');
select is(reserve_scan(), 'allowed', 'a normal invite is limited: 1 of 1 allowed');
select is(reserve_scan(), 'tester_limit', 'and then stopped by the per-tester limit');
select pg_temp.as_owner();
update scan_invites set unlimited = true where note = 'Owner';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4');
select is(
  (select reserve_scan() || ',' || reserve_scan() || ',' || reserve_scan()),
  'allowed,allowed,allowed', 'once unlimited, the owner is not stopped by the tester limit or the reached daily limit');
select is((scan_allowance() ->> 'tester_left')::int, 999, 'the scan screen sees plenty left');
select pg_temp.as_owner();
select is((select scans from scan_usage where user_id = '00000000-0000-0000-0000-0000000000d4'), 4, 'every unlimited scan is still counted');
update scan_limits set per_tester_daily = 2, global_daily = 3;

select * from finish();
rollback;
