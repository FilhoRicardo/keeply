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


-- Completion-based scheduling must be representable: a Task with several completions, read in order.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}', true); set local role authenticated;
select lives_ok($$ update public.maintenance_tasks set status = 'approved', approved_at = now(), scheduling_mode = 'completion_based', user_interval_count = 1, user_interval_unit = 'month'
  where id = '00000000-0000-0000-0000-0000000000a5' $$, 'a completion_based Task can be approved');
select lives_ok($$ insert into public.maintenance_completions (maintenance_task_id, completed_at, notes) values
  ('00000000-0000-0000-0000-0000000000a5', '2026-12-03 09:00+00', 'second'),
  ('00000000-0000-0000-0000-0000000000a5', '2026-11-02 09:00+00', 'first') $$, 'two completions can be stored');
select results_eq($$ select notes, completed_at from public.maintenance_completions
  where maintenance_task_id = '00000000-0000-0000-0000-0000000000a5' order by completed_at $$,
  $$ values ('first', '2026-11-02 09:00+00'::timestamptz), ('second', '2026-12-03 09:00+00'::timestamptz) $$,
  'completions are read in completion order');
select is((select count(*)::int from public.maintenance_completions), 2, 'the owner reads their completions');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}', true); set local role authenticated;
select is((select count(*)::int from public.maintenance_completions), 0, 'another user cannot read those completions');

reset role;
select * from finish();
rollback;
