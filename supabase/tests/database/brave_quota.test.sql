-- Brave Search is paid out of a free quota. The durable counter lives in Postgres (KEE-42, HANDOFF
-- §23). The orchestration layer checks it BEFORE calling searchManuals, so a Brave call that we
-- already know will be refused is never started. The check is atomic, the row persists across
-- serverless cold starts, and the hard-stop at the cap is enforced by Postgres.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
-- The local CI stub omits service_role's access to the test extension schema.
grant usage on schema extensions to service_role;

select plan(15);

-- The tables exist and are closed for visitors.
select ok(has_table_privilege('service_role', 'public.brave_quota_caps', 'select,insert,update,delete'), 'service role can manage quota caps');
select ok(has_table_privilege('service_role', 'public.brave_quota_usage', 'select,insert,update,delete'), 'service role can manage quota usage');
select ok(not has_table_privilege('authenticated', 'public.brave_quota_caps', 'select'), 'authenticated cannot read caps');
select ok(not has_table_privilege('authenticated', 'public.brave_quota_usage', 'select'), 'authenticated cannot read usage');

-- Default cap is in place: 2000 calls/month, one caps row, one usage row missing.
select is((select free_quota from public.brave_quota_caps), 2000::integer, 'default monthly cap is 2000');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.brave_quota_caps'::regclass),
  'RLS is enabled on caps'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.brave_quota_usage'::regclass),
  'RLS is enabled on usage'
);

-- status() reports 'ok' before any reservation.
select is(
  public.brave_quota_status() ->> 'status',
  'ok',
  'status is ok with no usage yet'
);

-- Reservations increment the durable counter.
set local role service_role;
select is(
  (select public.reserve_brave_search()),
  'allowed',
  'first reservation is allowed'
);
select is((select searches from public.brave_quota_usage), 1::integer, 'counter incremented to 1 after one reservation');
select is(
  (public.brave_quota_status() ->> 'used')::integer,
  1::integer,
  'status reflects one used call'
);

-- Direct tampering with the row is restricted.
set local role authenticated;
select throws_ok(
  $$ update public.brave_quota_usage set searches = 0 $$,
  '42501',
  null,
  'authenticated cannot write the durable counter'
);
select throws_ok(
  $$ select public.reserve_brave_search() $$,
  '42501',
  null,
  'only service_role may reserve a Brave call'
);

-- The hard-stop at the cap rejects without overshooting. Bumping usage to the cap and then calling
-- reserve_brave_search must return 'quota_exhausted' and leave the counter at the cap exactly.
set local role service_role;
update public.brave_quota_caps set free_quota = 2;
update public.brave_quota_usage set searches = 2 where month_start = date_trunc('month', (now() at time zone 'utc'))::date;
select is(
  (select public.reserve_brave_search()),
  'quota_exhausted',
  'reservation refuses at the cap'
);
select is(
  (select searches from public.brave_quota_usage),
  2::integer,
  'counter stays at the cap on a refused reservation'
);

select * from finish();
rollback;