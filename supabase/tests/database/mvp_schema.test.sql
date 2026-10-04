-- Run with `supabase test db` (or scripts/db-test.sh). Rules of the MVP schema.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(22);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'other@example.com');

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create function pg_temp.task(name text, level text, type text, url text, quote text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'instructions', 'Do it.', 'interval_count', 1, 'interval_unit', 'month',
    'evidence_level', level, 'source_type', type, 'source_title', 'Source', 'source_url', url, 'source_quote', quote) $$;

-- The owner adds a dishwasher with two proposals.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');
select lives_ok($$
  select add_appliance('Bosch', ' SMS6ZCI49E ', '', 0.9, jsonb_build_array(
    pg_temp.task('Clean the filter', 'manufacturer_verified', 'manufacturer_manual', 'https://bosch.example/manual.pdf', 'Clean the filters.'),
    pg_temp.task('Run a cleaning cycle', 'general_guidance', 'general_guidance', null, null)))
$$, 'add_appliance creates a dishwasher with its proposals');
select results_eq($$ select model, serial_number from appliances $$, $$ values ('SMS6ZCI49E'::text, null::text) $$,
  'identity is trimmed and blanks become null');
select results_eq($$ select name, status::text from maintenance_tasks order by position $$,
  $$ values ('Clean the filter'::text, 'proposed'::text), ('Run a cleaning cycle', 'proposed') $$,
  'tasks keep their order and start as proposals');
select throws_ok($$ select add_appliance('Bosch', null, null, null, '[]') $$, '23514', null,
  'a dishwasher needs at least one proposal');

-- Evidence must be backed by its source.
select throws_ok($$ select add_appliance('Bosch', null, null, null, jsonb_build_array(
  pg_temp.task('X', 'manufacturer_verified', 'manufacturer_manual', 'https://bosch.example/m.pdf', null))) $$,
  '23514', null, 'verified without a quote is rejected');
select throws_ok($$ select add_appliance('Bosch', null, null, null, jsonb_build_array(
  pg_temp.task('X', 'manufacturer_verified', 'similar_model_manual', 'https://bosch.example/m.pdf', 'Quote'))) $$,
  '23514', null, 'verified from a similar model is rejected');
select throws_ok($$ select add_appliance('Bosch', null, null, null, jsonb_build_array(
  pg_temp.task('X', 'manufacturer_verified', 'manufacturer_manual', 'http://bosch.example/m.pdf', 'Quote'))) $$,
  '23514', null, 'a non-https source link is rejected');
select throws_ok($$ select add_appliance('Bosch', null, null, null, jsonb_build_array(
  pg_temp.task('X', 'similar_model', 'general_guidance', null, null))) $$,
  '23514', null, 'similar-model from general guidance is rejected');

-- Proposals are never rewritten, and nothing reaches a calendar before Approval.
select throws_ok($$ update maintenance_tasks set interval_count = 6 where position = 1 $$, 'P0001', null,
  'the interval of a proposal cannot be changed');
select throws_ok($$ update maintenance_tasks set status = 'accepted', calendar_event_id = 'evt' where position = 1 $$,
  '23514', null, 'no calendar event before Approval');
select throws_ok($$ update appliances set approved_at = now(), start_date = '2026-10-05' $$, 'P0001', null,
  'Approval needs every task decided');
update maintenance_tasks set status = 'rejected';
select throws_ok($$ update appliances set approved_at = now(), start_date = '2026-10-05' $$, 'P0001', null,
  'Approval needs at least one accepted task');
update maintenance_tasks set status = 'accepted' where position = 1;
select lives_ok($$ update appliances set approved_at = now(), start_date = '2026-10-05' $$, 'Approval');
select throws_ok($$ update appliances set start_date = '2026-11-01' $$, 'P0001', null, 'Approval happens once');
select throws_ok($$ update maintenance_tasks set status = 'accepted' where position = 2 $$, 'P0001', null,
  'decisions freeze at Approval');
select throws_ok($$ update maintenance_tasks set calendar_event_id = 'evt' where position = 2 $$, '23514', null,
  'a rejected task never reaches a calendar');
select lives_ok($$ update maintenance_tasks set calendar_event_id = 'evt' where position = 1 $$,
  'an accepted task of an approved plan gets its calendar event');
select lives_ok($$ insert into funnel_events (name, props) values ('plan_approved', '{"accepted": 1}') $$,
  'visitors append their own usage events');
select throws_ok($$ select * from funnel_events $$, '42501', null, 'visitors cannot read usage events');

-- Another visitor sees nothing of the owner's and cannot add to it.
select pg_temp.act_as('00000000-0000-0000-0000-00000000000b');
select is((select count(*) from appliances) + (select count(*) from maintenance_tasks), 0::bigint,
  'other visitors see no dishwashers or tasks');
select is_empty($$ update maintenance_tasks set status = 'rejected' returning id $$, 'other visitors cannot decide tasks');
select throws_ok($$ insert into appliances (user_id, manufacturer) values ('00000000-0000-0000-0000-00000000000a', 'Miele') $$,
  '42501', null, 'nobody adds a dishwasher for someone else');

select * from finish();
rollback;
