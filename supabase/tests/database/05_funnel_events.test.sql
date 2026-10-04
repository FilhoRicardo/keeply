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
select lives_ok($$ insert into public.funnel_events (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'scan_started') $$,
  'insert with your own user_id succeeds');
select lives_ok($$ insert into public.funnel_events (user_id, appliance_id, name, props)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000a2', 'appliance_added', '{"source":"manual"}') $$,
  'insert with your own appliance and props succeeds');
select throws_ok($$ insert into public.funnel_events (user_id, name) values ('00000000-0000-0000-0000-00000000000b', 'scan_started') $$,
  '42501', null, 'insert with someone else''s user_id fails');
select throws_ok($$ insert into public.funnel_events (user_id, appliance_id, name)
  values ('00000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-0000000000b2', 'appliance_added') $$,
  '42501', null, 'insert pointing at someone else''s appliance fails');
select throws_ok($$ insert into public.funnel_events (user_id, name) values ('00000000-0000-0000-0000-00000000000a', 'made_up_event') $$,
  '23514', null, 'an event name outside the funnel list is rejected');
select is_empty($$ select * from public.funnel_events $$, 'select returns nothing to clients');
select is_empty($$ update public.funnel_events set name = 'task_completed' returning 1 $$, 'clients cannot update events');
select is_empty($$ delete from public.funnel_events returning 1 $$, 'clients cannot delete events');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated","is_anonymous":false}', true); set local role authenticated;
select is_empty($$ select * from public.funnel_events $$, 'B also sees nothing');

reset role;
select is((select count(*)::int from public.funnel_events), 2, 'the two valid events were stored and survived');

reset role;
select * from finish();
rollback;
