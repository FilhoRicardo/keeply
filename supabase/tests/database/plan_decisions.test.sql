-- Run with `supabase test db`. Decisions are a draft that freezes at Approval.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'other@example.com');

insert into public.appliances (id, home_id, manufacturer)
select '10000000-0000-0000-0000-000000000001', id, 'Bosch'
from public.homes where user_id = '00000000-0000-0000-0000-00000000000a';

insert into public.source_documents (id, appliance_id, source_type, title)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'general_guidance', 'General');

insert into public.maintenance_recommendations
  (id, appliance_id, task_name, description, recommended_interval_count, recommended_interval_unit, evidence_level, source_document_id)
values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Clean filter', 'Rinse', 1, 'month',
        'general_guidance', '20000000-0000-0000-0000-000000000001');

select throws_ok(
  $$ insert into public.plan_decisions (recommendation_id, appliance_id, kind)
     values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'customise') $$,
  '23514', null, 'a customise decision needs a full schedule'
);

select lives_ok(
  $$ insert into public.plan_decisions (recommendation_id, appliance_id, kind)
     values ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'include') $$,
  'an include decision is stored'
);

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000b"}';
select is((select count(*) from public.plan_decisions)::int, 0, 'another user cannot see decisions');
reset role;

insert into public.maintenance_tasks
  (appliance_id, recommendation_id, status, user_interval_count, user_interval_unit, start_date, scheduling_mode, approved_at)
values ('10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001',
        'approved', 1, 'month', '2026-10-05', 'fixed_calendar', now());

select throws_ok(
  $$ update public.plan_decisions set kind = 'skip' where recommendation_id = '30000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'decisions are frozen after approval'
);

select throws_ok(
  $$ delete from public.plan_decisions where recommendation_id = '30000000-0000-0000-0000-000000000001' $$,
  'P0001', null, 'decisions cannot be deleted after approval'
);

select lives_ok(
  $$ delete from public.appliances where id = '10000000-0000-0000-0000-000000000001' $$,
  'deleting an approved appliance still cascades'
);

select * from finish();
rollback;
