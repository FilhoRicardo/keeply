-- Run with `supabase test db`. Proves the schema enforces Keeply's non-negotiables.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

-- Two owners. The auth trigger gives each a profile and a home.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'other@example.com');

select is((select count(*) from public.homes)::int, 2, 'sign-up creates a default home per user');

insert into public.appliances (id, home_id, manufacturer, model)
select '10000000-0000-0000-0000-000000000001', id, 'Bosch', 'SMS6ZCI49E'
from public.homes where user_id = '00000000-0000-0000-0000-00000000000a';

select throws_ok(
  $$ insert into public.appliances (home_id, category, manufacturer)
     select id, 'fridge', 'Bosch' from public.homes limit 1 $$,
  '23514', null, 'only dishwashers are accepted'
);

insert into public.source_documents (id, appliance_id, source_type, title)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'general_guidance', 'General guidance');

select throws_ok(
  $$ insert into public.maintenance_recommendations
       (appliance_id, task_name, description, recommended_interval_count, recommended_interval_unit, evidence_level)
     values ('10000000-0000-0000-0000-000000000001', 'Clean filter', 'Rinse it', 1, 'month', 'general_guidance') $$,
  '23502', null, 'a recommendation without provenance is rejected'
);

insert into public.maintenance_recommendations
  (id, appliance_id, task_name, description, recommended_interval_count, recommended_interval_unit, evidence_level, source_document_id)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Clean filter', 'Rinse it', 14, 'day', 'general_guidance', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'Cleaning cycle', 'Run hot', 1, 'month', 'general_guidance', '20000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ update public.maintenance_recommendations set recommended_interval_count = 30
     where id = '30000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'a recommendation can never be rewritten'
);

insert into public.maintenance_tasks
  (id, appliance_id, recommendation_id, status, user_interval_count, user_interval_unit, start_date, scheduling_mode, approved_at)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
   'approved', 30, 'day', '2026-06-01', 'completion_based', now());

select is(
  (select recommended_interval_count from public.maintenance_recommendations where id = '30000000-0000-0000-0000-000000000001'),
  14, 'the manufacturer interval is kept alongside a different user interval'
);

select throws_ok(
  $$ insert into public.maintenance_tasks
       (appliance_id, recommendation_id, status, user_interval_count, user_interval_unit, start_date, scheduling_mode, calendar_event_id)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
             'skipped', 1, 'month', '2026-06-01', 'fixed_calendar', 'evt-1') $$,
  '23514', null, 'a skipped task cannot hold a calendar event'
);

select throws_ok(
  $$ insert into public.maintenance_tasks
       (appliance_id, recommendation_id, status, user_interval_count, user_interval_unit, start_date, scheduling_mode)
     values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002',
             'approved', 1, 'month', '2026-06-01', 'fixed_calendar') $$,
  '23514', null, 'an approved task records when it was approved'
);

select lives_ok(
  $$ update public.maintenance_tasks set calendar_event_id = 'evt-1'
     where id = '40000000-0000-0000-0000-000000000001' $$,
  'an approved task can hold a calendar event'
);

select lives_ok(
  $$ insert into public.maintenance_completions (maintenance_task_id, completed_on)
     values ('40000000-0000-0000-0000-000000000001', '2026-06-06') $$,
  'completions are recorded per task'
);

select throws_ok(
  $$ insert into public.maintenance_completions (maintenance_task_id, completed_on)
     values ('40000000-0000-0000-0000-000000000001', current_date + 7) $$,
  '23514', null, 'a completion cannot be in the future'
);

select throws_ok(
  $$ insert into public.maintenance_completions (maintenance_task_id, completed_on, notes)
     values ('40000000-0000-0000-0000-000000000001', '2026-06-06', repeat('x', 281)) $$,
  '23514', null, 'completion notes stay short'
);

update auth.users set email = 'linked@example.com', raw_user_meta_data = '{"full_name": "Linked Owner"}'
where id = '00000000-0000-0000-0000-00000000000a';
select is(
  (select email || ' / ' || name from public.users where id = '00000000-0000-0000-0000-00000000000a'),
  'linked@example.com / Linked Owner',
  'linking Google updates the profile'
);

-- Row-level security.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';

select is((select count(*) from public.appliances)::int, 0, 'another user cannot see the appliance');
select is((select count(*) from public.maintenance_recommendations)::int, 0, 'another user cannot see recommendations');
select is((select count(*) from public.maintenance_tasks)::int, 0, 'another user cannot see tasks');

set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';
select is((select count(*) from public.maintenance_recommendations)::int, 2, 'the owner sees their recommendations');

select * from finish();
rollback;
