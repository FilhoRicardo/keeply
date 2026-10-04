-- Keeply initial schema (KEE-2). Enforces the non-negotiables in the database itself.

create type public.evidence_level as enum ('manufacturer_verified', 'similar_model', 'general');
create type public.task_status as enum ('proposed', 'approved', 'skipped', 'paused', 'removed');
create type public.scheduling_mode as enum ('fixed_calendar', 'completion_based', 'condition_based');
create type public.interval_unit as enum ('day', 'week', 'month', 'year');

-- profiles: keyed to auth.users.id so an anonymous user keeps its data when a Google identity is linked.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text,
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.homes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table public.appliances (
  id uuid primary key default gen_random_uuid(),
  home_id uuid not null references public.homes (id) on delete cascade,
  category text not null default 'dishwasher' check (category = 'dishwasher'),
  manufacturer text,
  model text,
  serial_number text,
  image_url text,
  identification_confidence numeric check (identification_confidence between 0 and 1),
  created_at timestamptz not null default now()
);

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  source_type text not null check (source_type in
    ('manufacturer_manual', 'manufacturer_website', 'similar_model_manual', 'general_guidance', 'demo_fixture')),
  title text not null,
  reference text,
  manufacturer text,
  model_scope text,
  retrieved_at timestamptz,
  unique (id, appliance_id)
);

-- A Recommendation is what a source says. It is never edited (see the trigger below and RLS).
create table public.maintenance_recommendations (
  id uuid primary key default gen_random_uuid(),
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  task_name text not null,
  description text,
  interval_count int check (interval_count > 0),
  interval_unit public.interval_unit,
  trigger_condition text check (trigger_condition <> ''),
  evidence_level public.evidence_level not null,
  source_document_id uuid,
  source_location text,
  confidence numeric check (confidence between 0 and 1),
  created_at timestamptz not null default now(),
  unique (id, appliance_id),
  foreign key (source_document_id, appliance_id) references public.source_documents (id, appliance_id),
  -- Exactly one of: a recurring interval, or a condition (Q8).
  constraint recommendation_interval_xor_condition check (
    (interval_count is not null and interval_unit is not null and trigger_condition is null)
    or (interval_count is null and interval_unit is null and trigger_condition is not null)
  ),
  -- Manufacturer verified is never claimed without a real source.
  constraint recommendation_verified_needs_source check (
    evidence_level <> 'manufacturer_verified' or source_document_id is not null
  )
);

create function public.reject_recommendation_update() returns trigger
language plpgsql as $$
begin
  if new is distinct from old then
    raise exception 'maintenance_recommendations are immutable' using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger recommendation_is_immutable before update on public.maintenance_recommendations
  for each row execute function public.reject_recommendation_update();

-- A Task is what the owner approved, with their own schedule, separate from the Recommendation.
create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  recommendation_id uuid not null,
  status public.task_status not null default 'proposed',
  scheduling_mode public.scheduling_mode not null,
  user_interval_count int check (user_interval_count > 0),
  user_interval_unit public.interval_unit,
  start_date date,
  approved_at timestamptz,
  calendar_event_id text,
  created_at timestamptz not null default now(),
  foreign key (recommendation_id, appliance_id) references public.maintenance_recommendations (id, appliance_id),
  constraint task_interval_complete check ((user_interval_count is null) = (user_interval_unit is null)),
  -- condition_based has no interval; the other two modes need one.
  constraint task_mode_matches_interval check (
    (scheduling_mode = 'condition_based') = (user_interval_count is null)
  ),
  -- Nothing reaches a calendar before Approval.
  constraint task_calendar_event_needs_approval check (
    calendar_event_id is null or (status = 'approved' and approved_at is not null)
  )
);

-- Next due is derived in the domain from these rows, not stored.
create table public.maintenance_completions (
  id uuid primary key default gen_random_uuid(),
  maintenance_task_id uuid not null references public.maintenance_tasks (id) on delete cascade,
  completed_at timestamptz not null,
  notes text,
  created_at timestamptz not null default now()
);
create index maintenance_completions_task_completed_idx
  on public.maintenance_completions (maintenance_task_id, completed_at);

create table public.funnel_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  appliance_id uuid references public.appliances (id) on delete set null,
  name text not null check (name in (
    'scan_started', 'appliance_identified', 'model_confirmed', 'recommendations_generated',
    'recommendations_decided', 'calendar_connected', 'calendar_tasks_created',
    'task_completed', 'appliance_added'
  )),
  props jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index homes_user_id_idx on public.homes (user_id);
create index appliances_home_id_idx on public.appliances (home_id);
create index maintenance_tasks_appliance_id_idx on public.maintenance_tasks (appliance_id);
