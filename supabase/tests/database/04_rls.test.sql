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


-- A is anonymous, B is linked. Both are role authenticated and must be isolated identically.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated","is_anonymous":true}', true); set local role authenticated;
select is((select count(*)::int from public.homes), 1, 'A sees only their own home');
select is((select count(*)::int from public.appliances), 1, 'A sees only their own appliance');
select is((select count(*)::int from public.source_documents), 1, 'A sees only their own source documents');
select is((select count(*)::int from public.maintenance_recommendations), 1, 'A sees only their own Recommendations');
select is((select count(*)::int from public.maintenance_tasks), 1, 'A sees only their own Tasks');
select is((select count(*)::int from public.profiles), 1, 'A sees only their own profile');
select is((select count(*)::int from public.maintenance_completions), 0, 'A sees no completions (none exist)');

select throws_ok($$ insert into public.homes (user_id, name) values ('00000000-0000-0000-0000-00000000000b', 'Hijack') $$,
  '42501', null, 'A cannot insert a home for B');
select throws_ok($$ insert into public.appliances (home_id, category) values ('00000000-0000-0000-0000-0000000000b1', 'dishwasher') $$,
  '42501', null, 'A cannot insert an appliance into B''s home');
select throws_ok($$ insert into public.source_documents (appliance_id, source_type, title) values ('00000000-0000-0000-0000-0000000000b2', 'demo_fixture', 'x') $$,
  '42501', null, 'A cannot insert a source document for B''s appliance');
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level)
  values ('00000000-0000-0000-0000-0000000000b2', 'x', 1, 'month', 'general') $$,
  '42501', null, 'A cannot insert a Recommendation for B''s appliance');
select throws_ok($$ insert into public.maintenance_tasks (appliance_id, recommendation_id, scheduling_mode, user_interval_count, user_interval_unit)
  values ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b4', 'fixed_calendar', 1, 'month') $$,
  '42501', null, 'A cannot insert a Task for B''s appliance');
select throws_ok($$ insert into public.maintenance_completions (maintenance_task_id, completed_at)
  values ('00000000-0000-0000-0000-0000000000b5', now()) $$,
  '42501', null, 'A cannot insert a completion for B''s Task');

select is_empty($$ update public.homes set name = 'x' where id = '00000000-0000-0000-0000-0000000000b1' returning 1 $$, 'A cannot update B''s home');
select is_empty($$ update public.appliances set model = 'x' where id = '00000000-0000-0000-0000-0000000000b2' returning 1 $$, 'A cannot update B''s appliance');
select is_empty($$ update public.maintenance_tasks set scheduling_mode = 'completion_based' where id = '00000000-0000-0000-0000-0000000000b5' returning 1 $$, 'A cannot update B''s Task');
select throws_ok($$ update public.appliances set home_id = '00000000-0000-0000-0000-0000000000b1' where id = '00000000-0000-0000-0000-0000000000a2' $$,
  '42501', null, 'A cannot move their appliance into B''s home');
select throws_ok($$ update public.maintenance_tasks set appliance_id = '00000000-0000-0000-0000-0000000000b2' where id = '00000000-0000-0000-0000-0000000000a5' $$,
  '42501', null, 'A cannot move their Task to B''s appliance');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}', true); set local role authenticated;
select is((select count(*)::int from public.homes where id = '00000000-0000-0000-0000-0000000000a1'), 0, 'B cannot see A''s home');
select is((select count(*)::int from public.appliances where id = '00000000-0000-0000-0000-0000000000a2'), 0, 'B cannot see A''s appliance');
select is((select count(*)::int from public.maintenance_recommendations where id = '00000000-0000-0000-0000-0000000000a4'), 0, 'B cannot see A''s Recommendation');
select is((select count(*)::int from public.maintenance_tasks where id = '00000000-0000-0000-0000-0000000000a5'), 0, 'B cannot see A''s Task');
select throws_ok($$ insert into public.appliances (home_id, category) values ('00000000-0000-0000-0000-0000000000a1', 'dishwasher') $$,
  '42501', null, 'B cannot insert an appliance into A''s home');
select is_empty($$ update public.maintenance_tasks set scheduling_mode = 'completion_based' where id = '00000000-0000-0000-0000-0000000000a5' returning 1 $$, 'B cannot update A''s Task');

-- Without a JWT nothing is visible or writable.
reset role;
set local role anon;
select is_empty($$ select * from public.homes $$, 'the anon role (no session) sees no homes');

reset role;
select * from finish();
rollback;
