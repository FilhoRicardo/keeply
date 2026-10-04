-- Validation funnel (docs/HANDOFF.md §15). Ids and counts only, no names or models.
-- Visitors can only append their own events; reading is for the service role (analysis).
create table public.funnel_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (name in (
    'appliance_added', 'recommendations_generated', 'recommendation_decided', 'plan_approved',
    'calendar_connected', 'calendar_tasks_created', 'task_completed'
  )),
  appliance_id uuid,
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object' and length(props::text) <= 500),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index funnel_events_name_idx on public.funnel_events (name, occurred_at);

alter table public.funnel_events enable row level security;

create policy "append own events" on public.funnel_events
  for insert to authenticated with check (user_id = (select auth.uid()));

revoke select, update, delete on public.funnel_events from anon, authenticated;
