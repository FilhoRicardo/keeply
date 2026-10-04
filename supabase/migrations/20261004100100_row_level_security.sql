-- RLS on every table: a user only reaches rows under their own home.
-- Anonymous Supabase users are role `authenticated`, so they get exactly the same policies.

alter table public.profiles enable row level security;
alter table public.homes enable row level security;
alter table public.appliances enable row level security;
alter table public.source_documents enable row level security;
alter table public.maintenance_recommendations enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.maintenance_completions enable row level security;
alter table public.funnel_events enable row level security;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy homes_select_own on public.homes for select to authenticated
  using (user_id = (select auth.uid()));
create policy homes_insert_own on public.homes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy homes_update_own on public.homes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy appliances_select_own on public.appliances for select to authenticated
  using (exists (select 1 from public.homes h where h.id = home_id and h.user_id = (select auth.uid())));
create policy appliances_insert_own on public.appliances for insert to authenticated
  with check (exists (select 1 from public.homes h where h.id = home_id and h.user_id = (select auth.uid())));
create policy appliances_update_own on public.appliances for update to authenticated
  using (exists (select 1 from public.homes h where h.id = home_id and h.user_id = (select auth.uid())))
  with check (exists (select 1 from public.homes h where h.id = home_id and h.user_id = (select auth.uid())));

-- source_documents and maintenance_recommendations are insert/select only.
create policy source_documents_select_own on public.source_documents for select to authenticated
  using (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())));
create policy source_documents_insert_own on public.source_documents for insert to authenticated
  with check (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())));

create policy recommendations_select_own on public.maintenance_recommendations for select to authenticated
  using (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())));
create policy recommendations_insert_own on public.maintenance_recommendations for insert to authenticated
  with check (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())));
-- No UPDATE policy, and the privilege is revoked as a second layer. A trigger covers non-RLS roles.
revoke update on public.maintenance_recommendations from authenticated, anon;

create policy tasks_select_own on public.maintenance_tasks for select to authenticated
  using (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())));
create policy tasks_insert_own on public.maintenance_tasks for insert to authenticated
  with check (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())));
create policy tasks_update_own on public.maintenance_tasks for update to authenticated
  using (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())))
  with check (exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
    where a.id = appliance_id and h.user_id = (select auth.uid())));

create policy completions_select_own on public.maintenance_completions for select to authenticated
  using (exists (select 1 from public.maintenance_tasks t
    join public.appliances a on a.id = t.appliance_id join public.homes h on h.id = a.home_id
    where t.id = maintenance_task_id and h.user_id = (select auth.uid())));
create policy completions_insert_own on public.maintenance_completions for insert to authenticated
  with check (exists (select 1 from public.maintenance_tasks t
    join public.appliances a on a.id = t.appliance_id join public.homes h on h.id = a.home_id
    where t.id = maintenance_task_id and h.user_id = (select auth.uid())));

-- funnel_events: insert-only for clients; no SELECT, UPDATE or DELETE policy.
create policy funnel_events_insert_own on public.funnel_events for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (appliance_id is null or exists (select 1 from public.appliances a join public.homes h on h.id = a.home_id
      where a.id = appliance_id and h.user_id = (select auth.uid())))
  );
