begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select no_plan();

-- Fixture: A is an anonymous user, B is a linked (non-anonymous) user. Each owns a home,
-- a dishwasher, a source document, a Recommendation and a proposed Task.
insert into auth.users (id, aud, role, email, is_anonymous) values
  ('00000000-0000-0000-0000-00000000000a', 'authenticated', 'authenticated', null, true),
  ('00000000-0000-0000-0000-00000000000b', 'authenticated', 'authenticated', 'b@example.com', false);
insert into public.homes (id, user_id, name) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-00000000000a', 'Home A'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-00000000000b', 'Home B');
insert into public.appliances (id, home_id, category, manufacturer, model) values
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 'dishwasher', 'Bosch', 'SMS46'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b1', 'dishwasher', 'Miele', 'G7100');
insert into public.source_documents (id, appliance_id, source_type, title) values
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a2', 'demo_fixture', 'Fixture A'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000b2', 'demo_fixture', 'Fixture B');
insert into public.maintenance_recommendations
  (id, appliance_id, task_name, interval_count, interval_unit, evidence_level, source_document_id) values
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000a2', 'Clean filter', 1, 'month', 'manufacturer_verified', '00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000b2', 'Clean filter', 1, 'month', 'general', null);
insert into public.maintenance_tasks
  (id, appliance_id, recommendation_id, status, scheduling_mode, user_interval_count, user_interval_unit, start_date) values
  ('00000000-0000-0000-0000-0000000000a5', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'proposed', 'fixed_calendar', 1, 'month', '2026-11-01'),
  ('00000000-0000-0000-0000-0000000000b5', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b4', 'proposed', 'fixed_calendar', 1, 'month', '2026-11-01');


-- Recommendations are never edited: no UPDATE policy, no UPDATE privilege, and a trigger as a backstop.
select is_empty($$ select 1 from pg_policies where schemaname = 'public'
  and tablename = 'maintenance_recommendations' and cmd in ('UPDATE', 'ALL') $$,
  'no UPDATE policy exists on maintenance_recommendations');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}', true); set local role authenticated;
select throws_ok($$ update public.maintenance_recommendations set task_name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000a4' $$,
  '42501', null, 'owner cannot update a Recommendation task name');
select throws_ok($$ update public.maintenance_recommendations set interval_count = 6 where id = '00000000-0000-0000-0000-0000000000a4' $$,
  '42501', null, 'owner cannot update a Recommendation interval');
select throws_ok($$ update public.maintenance_recommendations set trigger_condition = 'when it smells', interval_count = null, interval_unit = null where id = '00000000-0000-0000-0000-0000000000a4' $$,
  '42501', null, 'owner cannot update a Recommendation trigger condition');
select throws_ok($$ update public.maintenance_recommendations set evidence_level = 'general' where id = '00000000-0000-0000-0000-0000000000a4' $$,
  '42501', null, 'owner cannot update a Recommendation evidence level');
select throws_ok($$ update public.maintenance_recommendations set source_document_id = null where id = '00000000-0000-0000-0000-0000000000a4' $$,
  '42501', null, 'owner cannot update a Recommendation source');

reset role;
select throws_ok($$ update public.maintenance_recommendations set task_name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000a4' $$,
  '23001', null, 'trigger rejects content updates even without RLS (service role / superuser)');
select throws_ok($$ update public.maintenance_recommendations set evidence_level = 'general' where id = '00000000-0000-0000-0000-0000000000a4' $$,
  '23001', null, 'trigger rejects evidence level updates even without RLS');
select results_eq($$ select task_name, interval_count, evidence_level::text from public.maintenance_recommendations where id = '00000000-0000-0000-0000-0000000000a4' $$,
  $$ values ('Clean filter', 1, 'manufacturer_verified') $$, 'the Recommendation is unchanged');

-- Exactly one of an interval or a trigger condition (Q8).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}', true); set local role authenticated;
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, trigger_condition, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'Both', 1, 'month', 'when the light is on', 'general') $$,
  '23514', null, 'a Recommendation with both an interval and a trigger condition is rejected');
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'Neither', 'general') $$,
  '23514', null, 'a Recommendation with neither an interval nor a trigger condition is rejected');
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'Count only', 1, 'general') $$,
  '23514', null, 'an interval count without a unit is rejected');
select lives_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'Interval only', 3, 'month', 'general') $$,
  'an interval-only Recommendation is accepted');
select lives_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, trigger_condition, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'Condition only', 'when the salt refill indicator lights up', 'similar_model') $$,
  'a condition-only Recommendation is accepted');

reset role;
select * from finish();
rollback;
