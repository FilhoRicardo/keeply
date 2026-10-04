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


select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'x', 1, 'month', 'verified') $$,
  '22P02', null, 'evidence_level rejects a value outside the three levels');
select lives_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'x', 1, 'month', 'similar_model') $$,
  'evidence_level accepts similar_model');
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'x', 1, 'month', 'manufacturer_verified') $$,
  '23514', null, 'manufacturer_verified requires a source document');
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'x', 0, 'month', 'general') $$,
  '23514', null, 'an interval count must be positive');
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level)
  values ('00000000-0000-0000-0000-0000000000a2', 'x', 1, 'fortnight', 'general') $$,
  '22P02', null, 'interval_unit rejects a value outside day/week/month/year');
select throws_ok($$ insert into public.appliances (home_id, category) values ('00000000-0000-0000-0000-0000000000a1', 'oven') $$,
  '23514', null, 'category rejects anything but dishwasher');
select throws_ok($$ insert into public.source_documents (appliance_id, source_type, title)
  values ('00000000-0000-0000-0000-0000000000a2', 'blog_post', 'x') $$,
  '23514', null, 'source_type rejects an unknown value');
select lives_ok($$ insert into public.source_documents (appliance_id, source_type, title)
  values ('00000000-0000-0000-0000-0000000000a2', 'demo_fixture', 'x') $$,
  'source_type accepts demo_fixture');
select throws_ok($$ insert into public.maintenance_recommendations (appliance_id, task_name, interval_count, interval_unit, evidence_level, source_document_id)
  values ('00000000-0000-0000-0000-0000000000a2', 'x', 1, 'month', 'general', '00000000-0000-0000-0000-0000000000b3') $$,
  '23503', null, 'a Recommendation cannot cite a source document of another Appliance');

reset role;
select * from finish();
rollback;
