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


select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}', true); set local role authenticated;
-- Nothing reaches a calendar before Approval: calendar_event_id needs status approved AND approved_at.
select throws_ok($$ update public.maintenance_tasks set calendar_event_id = 'evt1' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'a proposed Task cannot hold a calendar_event_id');
select throws_ok($$ update public.maintenance_tasks set status = 'skipped', calendar_event_id = 'evt1' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'a skipped Task cannot hold a calendar_event_id');
select throws_ok($$ update public.maintenance_tasks set status = 'paused', calendar_event_id = 'evt1' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'a paused Task cannot hold a calendar_event_id');
select throws_ok($$ update public.maintenance_tasks set status = 'removed', calendar_event_id = 'evt1', approved_at = now() where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'a removed Task cannot hold a calendar_event_id');
select throws_ok($$ update public.maintenance_tasks set status = 'approved', calendar_event_id = 'evt1' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'an approved Task without approved_at cannot hold a calendar_event_id');
select throws_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, status, scheduling_mode, user_interval_count, user_interval_unit, calendar_event_id)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'proposed', 'fixed_calendar', 1, 'month', 'evt1') $$,
  '23514', null, 'inserting a proposed Task with a calendar_event_id fails');
select lives_ok($$ update public.maintenance_tasks set status = 'approved', approved_at = now(), calendar_event_id = 'evt1' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  'an approved Task with approved_at can hold a calendar_event_id');
select throws_ok($$ update public.maintenance_tasks set status = 'removed' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'removing an approved Task requires clearing its calendar_event_id');
select lives_ok($$ update public.maintenance_tasks set status = 'removed', calendar_event_id = null where id = '00000000-0000-0000-0000-0000000000a5' $$,
  'an approved Task can be removed once its calendar_event_id is cleared');

-- The owner's schedule is independent of the Recommendation.
select lives_ok($$ update public.maintenance_tasks set user_interval_count = 3, user_interval_unit = 'week', scheduling_mode = 'completion_based' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  'the owner can change a Task schedule');
select results_eq($$ select interval_count, interval_unit::text, trigger_condition, task_name, evidence_level::text
  from public.maintenance_recommendations where id = '00000000-0000-0000-0000-0000000000a4' $$,
  $$ values (1, 'month', null::text, 'Clean filter', 'manufacturer_verified') $$,
  'changing the Task interval leaves the Recommendation unchanged');

-- Scheduling mode vs interval.
select throws_ok($$ update public.maintenance_tasks set scheduling_mode = 'condition_based' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'condition_based with a user interval is rejected');
select throws_ok($$ update public.maintenance_tasks set user_interval_count = null, user_interval_unit = null where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '23514', null, 'completion_based without a user interval is rejected');
select throws_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, scheduling_mode)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'fixed_calendar') $$,
  '23514', null, 'fixed_calendar without a user interval is rejected');
select throws_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, scheduling_mode, user_interval_count)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'fixed_calendar', 1) $$,
  '23514', null, 'a user interval count without a unit is rejected');
select lives_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, scheduling_mode)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'condition_based') $$,
  'condition_based without a user interval is accepted');
select throws_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, scheduling_mode, user_interval_count, user_interval_unit)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'weekly', 1, 'week') $$,
  '22P02', null, 'an unknown scheduling mode is rejected');
select throws_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, status, scheduling_mode, user_interval_count, user_interval_unit)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a4', 'deleted', 'fixed_calendar', 1, 'week') $$,
  '22P02', null, 'an unknown task status is rejected');

-- A Task must point at a Recommendation of the same Appliance.
reset role;
select throws_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, scheduling_mode, user_interval_count, user_interval_unit)
  values ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b4', 'fixed_calendar', 1, 'week') $$,
  '23503', null, 'a Task cannot reference a Recommendation of another Appliance');

reset role;
select * from finish();
rollback;
