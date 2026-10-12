-- RF-356. Google sign-in may reserve AI scans without an invite. Anonymous sessions still need one.
-- The shared cap counts non-owner scans only. Run with `supabase test db` or scripts/db-test.sh.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(26);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'anon@example.com'),
  ('00000000-0000-0000-0000-0000000000b2', 'anon-invited@example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'google@example.com'),
  ('00000000-0000-0000-0000-0000000000d4', 'google-two@example.com'),
  ('00000000-0000-0000-0000-0000000000e5', 'google-code@example.com'),
  ('00000000-0000-0000-0000-0000000000f6', 'owner@example.com');

create function pg_temp.act_as(uid text, anonymous boolean) returns void language sql as $$
  select set_config(
    'request.jwt.claims',
    json_build_object('sub', uid, 'role', 'authenticated', 'is_anonymous', anonymous)::text,
    true
  );
  set local role authenticated;
$$;
create function pg_temp.as_owner() returns void language sql as $$
  reset role;
  select set_config('request.jwt.claims', '', true);
$$;
create function pg_temp.reserve_n(n int) returns text language plpgsql as $$
declare
  i int;
  acc text := '';
  r text;
begin
  for i in 1..n loop
    r := public.reserve_scan();
    acc := case when acc = '' then r else acc || ',' || r end;
  end loop;
  return acc;
end;
$$;
grant execute on function pg_temp.reserve_n(int) to authenticated;

select is((select per_tester_daily from scan_limits), 10, 'each person gets 10 scans a day');
select is((select global_daily from scan_limits), 12, 'non-owner scans share 12 a day');

-- Anonymous, no invite: refused, and nothing is counted.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1', true);
select is(scan_invite_status(), 'no_invite', 'an anonymous session without an invite is refused');
select is(reserve_scan(), 'no_invite', 'an anonymous session without an invite cannot reserve');

-- Google sign-in, no invite: the deployed app sees 'invited' and a full allowance.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3', false);
select is(scan_invite_status(), 'invited', 'a Google sign-in may scan without an invite');
select is((scan_allowance() ->> 'status'), 'invited', 'the scan screen treats a Google sign-in as allowed');
select is((scan_allowance() ->> 'tester_left')::int, 10, 'a new Google account has 10 scans left');
select is((scan_allowance() ->> 'global_left')::int, 12, 'the shared cap is still full');

-- A Google account can still redeem a code (the owner's unlimited flag is set on one).
select pg_temp.as_owner();
create temp table codes (note text, code text);
insert into codes values ('Code', create_scan_invite('Code')), ('Anon', create_scan_invite('Anon')), ('Owner', create_scan_invite('Owner'));
grant select on codes to authenticated;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e5', false);
select is(redeem_scan_invite((select code from codes where note = 'Code')), 'invited', 'a Google account can still redeem a code');
select is(redeem_scan_invite((select code from codes where note = 'Anon')), 'already_invited', 'a second code is refused once one is live');

-- Anonymous with an invite is allowed. Revoking that invite stops them; it does not stop Google.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2', true);
select is(redeem_scan_invite((select code from codes where note = 'Anon')), 'invited', 'an anonymous session redeems an invite');
select is(reserve_scan(), 'allowed', 'an anonymous session with an invite can reserve');
select pg_temp.as_owner();
update scan_invites set revoked_at = now() where note = 'Anon';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000b2', true);
select is(reserve_scan(), 'no_invite', 'a revoked invite stops an anonymous session');
select pg_temp.as_owner();
update scan_invites set revoked_at = now() where note = 'Code';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e5', false);
select is(reserve_scan(), 'allowed', 'revoking an invite does not stop a Google sign-in');

-- Clear the identity checks so the cap assertions start from zero.
select pg_temp.as_owner();
delete from scan_usage;
delete from scan_daily_totals;

-- The owner's scans are recorded and do not use the shared cap.
update scan_invites set unlimited = true where note = 'Owner';
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6', false);
select is(redeem_scan_invite((select code from codes where note = 'Owner')), 'invited', 'the owner redeems the unlimited invite');
select is(pg_temp.reserve_n(3), 'allowed,allowed,allowed', 'the owner is not stopped');
select pg_temp.as_owner();
select is((select scans from scan_daily_totals), 0, 'owner scans do not use the shared cap');
select is((select scans from scan_usage where user_id = '00000000-0000-0000-0000-0000000000f6'), 3, 'owner scans are still recorded');

-- 10 for one Google account, then the shared 12, then the 13th non-owner scan is the daily cap.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c3', false);
select is(
  pg_temp.reserve_n(11),
  repeat('allowed,', 10) || 'tester_limit',
  'a Google user without an invite is allowed 10 times, then tester_limit'
);
select is((scan_allowance() ->> 'tester_left')::int, 0, 'that account has nothing left today');
select pg_temp.as_owner();
select is((select scans from scan_daily_totals), 10, 'the refused 11th scan was not counted');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4', false);
select is(
  pg_temp.reserve_n(3),
  'allowed,allowed,daily_limit',
  'the 13th non-owner scan of the day is daily_limit'
);
select pg_temp.as_owner();
select is((select scans from scan_daily_totals), 12, 'the shared cap stops at 12 non-owner scans');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000f6', false);
select is(reserve_scan(), 'allowed', 'the owner can still scan when the shared cap is full');
select pg_temp.as_owner();
select is((select scans from scan_daily_totals), 12, 'that owner scan still does not use the shared cap');

-- No limits row: fail closed, including for Google sign-in.
delete from scan_limits;
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d4', false);
select is(reserve_scan(), 'daily_limit', 'a Google sign-in gets nothing when the limits row is missing');

select * from finish();
rollback;
