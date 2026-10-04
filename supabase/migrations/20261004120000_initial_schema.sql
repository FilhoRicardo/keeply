-- Keeply v0.1 initial schema (docs/HANDOFF.md §9).
-- Non-negotiables enforced here, not only in app code:
--   * a Recommendation is never rewritten (update trigger)
--   * the user's schedule lives on the Task, separate from the Recommendation
--   * every Recommendation has provenance (source_document_id not null)
--   * nothing carries a calendar event before Approval (check constraints)
--   * completion-based scheduling is modelled from day one

create type public.evidence_level as enum ('manufacturer_verified', 'similar_model', 'general_guidance');
create type public.interval_unit as enum ('day', 'week', 'month', 'year');
create type public.task_status as enum ('proposed', 'approved', 'skipped', 'paused');
create type public.scheduling_mode as enum ('fixed_calendar', 'completion_based');
create type public.source_type as enum (
  'manufacturer_manual',
  'manufacturer_website',
  'similar_model_manual',
  'general_guidance'
);

create table public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  email text,
  created_at timestamptz not null default now()
);

create table public.homes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null default 'My home',
  created_at timestamptz not null default now()
);
create index homes_user_id_idx on public.homes (user_id);

create table public.appliances (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id) on delete cascade,
  -- v0.1 is dishwashers only.
  category text not null default 'dishwasher' check (category = 'dishwasher'),
  manufacturer text not null check (length(trim(manufacturer)) > 0),
  model text,
  serial_number text,
  image_url text,
  identification_confidence numeric(3, 2) check (identification_confidence between 0 and 1),
  created_at timestamptz not null default now()
);
create index appliances_home_id_idx on public.appliances (home_id);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  source_type public.source_type not null,
  title text not null,
  reference text,
  manufacturer text,
  model_scope text,
  retrieved_at timestamptz not null default now(),
  unique (id, appliance_id)
);
create index source_documents_appliance_id_idx on public.source_documents (appliance_id);

create table public.maintenance_recommendations (
  id uuid primary key default gen_random_uuid(),
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  task_name text not null,
  description text not null,
  recommended_interval_count integer not null check (recommended_interval_count > 0),
  recommended_interval_unit public.interval_unit not null,
  evidence_level public.evidence_level not null,
  source_document_id uuid not null,
  source_location text,
  confidence numeric(3, 2) check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (id, appliance_id),
  foreign key (source_document_id, appliance_id) references public.source_documents (id, appliance_id) on delete cascade
);
create index maintenance_recommendations_appliance_id_idx on public.maintenance_recommendations (appliance_id);

create function public.forbid_recommendation_update() returns trigger
language plpgsql as $$
begin
  raise exception 'maintenance_recommendations are immutable; record the owner''s choice on maintenance_tasks'
    using errcode = 'P0001';
end;
$$;

create trigger maintenance_recommendations_immutable
  before update on public.maintenance_recommendations
  for each row execute function public.forbid_recommendation_update();

create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  recommendation_id uuid not null,
  status public.task_status not null default 'proposed',
  user_interval_count integer not null check (user_interval_count > 0),
  user_interval_unit public.interval_unit not null,
  start_date date not null,
  scheduling_mode public.scheduling_mode not null,
  calendar_event_id text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recommendation_id),
  foreign key (recommendation_id, appliance_id)
    references public.maintenance_recommendations (id, appliance_id) on delete cascade,
  constraint approved_tasks_have_approval check (status not in ('approved', 'paused') or approved_at is not null),
  constraint calendar_only_after_approval check (
    calendar_event_id is null or (status in ('approved', 'paused') and approved_at is not null)
  )
);
create index maintenance_tasks_appliance_id_idx on public.maintenance_tasks (appliance_id);

create table public.maintenance_completions (
  id uuid primary key default gen_random_uuid(),
  maintenance_task_id uuid not null references public.maintenance_tasks (id) on delete cascade,
  completed_on date not null,
  notes text,
  created_at timestamptz not null default now()
);
create index maintenance_completions_task_idx on public.maintenance_completions (maintenance_task_id, completed_on desc);

-- New sign-ups get a profile and a default home.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.users (id, name, email)
  values (new.id, new.raw_user_meta_data ->> 'name', new.email);
  insert into public.homes (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row-level security: an owner sees only their own homes and everything under them.
create function public.owns_appliance(target uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.appliances a
    join public.homes h on h.id = a.home_id
    where a.id = target and h.user_id = (select auth.uid())
  );
$$;

alter table public.users enable row level security;
alter table public.homes enable row level security;
alter table public.appliances enable row level security;
alter table public.source_documents enable row level security;
alter table public.maintenance_recommendations enable row level security;
alter table public.maintenance_tasks enable row level security;
alter table public.maintenance_completions enable row level security;

create policy "own profile" on public.users
  for all to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "own homes" on public.homes
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "own appliances" on public.appliances
  for all to authenticated
  using (home_id in (select id from public.homes where user_id = (select auth.uid())))
  with check (home_id in (select id from public.homes where user_id = (select auth.uid())));

create policy "own source documents" on public.source_documents
  for all to authenticated using (public.owns_appliance(appliance_id)) with check (public.owns_appliance(appliance_id));

-- Recommendations: read, insert and delete only. The trigger rejects updates for every role.
create policy "read own recommendations" on public.maintenance_recommendations
  for select to authenticated using (public.owns_appliance(appliance_id));
create policy "insert own recommendations" on public.maintenance_recommendations
  for insert to authenticated with check (public.owns_appliance(appliance_id));
create policy "delete own recommendations" on public.maintenance_recommendations
  for delete to authenticated using (public.owns_appliance(appliance_id));

create policy "own tasks" on public.maintenance_tasks
  for all to authenticated using (public.owns_appliance(appliance_id)) with check (public.owns_appliance(appliance_id));

create policy "own completions" on public.maintenance_completions
  for all to authenticated
  using (exists (
    select 1 from public.maintenance_tasks t
    where t.id = maintenance_task_id and public.owns_appliance(t.appliance_id)
  ))
  with check (exists (
    select 1 from public.maintenance_tasks t
    where t.id = maintenance_task_id and public.owns_appliance(t.appliance_id)
  ));
