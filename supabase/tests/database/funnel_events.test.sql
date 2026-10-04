-- Run with `supabase test db`. Funnel events are append-only for visitors.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.com');

set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';

select lives_ok(
  $$ insert into public.funnel_events (name, props, occurred_at) values ('plan_approved', '{"approved": 2}', now()) $$,
  'a visitor can append their own event'
);

select throws_ok(
  $$ insert into public.funnel_events (name, occurred_at) values ('page_view', now()) $$,
  '23514', null, 'only known funnel events are accepted'
);

select throws_ok(
  $$ insert into public.funnel_events (user_id, name, occurred_at)
     values ('00000000-0000-0000-0000-00000000000b', 'plan_approved', now()) $$,
  '42501', null, 'a visitor cannot write events for someone else'
);

select throws_ok(
  $$ select count(*) from public.funnel_events $$,
  '42501', null, 'visitors cannot read events'
);

select throws_ok(
  $$ select * from public.funnel_summary $$,
  '42501', null, 'visitors cannot read the funnel summary'
);

reset role;
select results_eq(
  $$ select step, visitors::int, events::int from public.funnel_summary $$,
  $$ values ('plan_approved'::text, 1, 1) $$,
  'the team sees distinct visitors and events per step'
);

select * from finish();
rollback;
