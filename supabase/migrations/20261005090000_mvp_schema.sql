-- Keeply MVP schema (docs/HANDOFF.md §24): users are Supabase Auth users (auth.users); each user
-- has dishwashers; each dishwasher has the maintenance tasks Keeply proposed, which the owner
-- accepts or rejects. After Approval the owner manages the accepted tasks in Google Calendar.
-- Rules enforced here, not only in app code:
--   * a proposed task (what its source says) is never rewritten, only accepted or rejected
--   * Manufacturer verified needs a linked, quoted manufacturer document
--   * nothing carries a calendar event before Approval, and only accepted tasks ever do
--   * decisions freeze at Approval, which needs every task decided and at least one accepted

create type public.evidence_level as enum ('manufacturer_verified', 'similar_model', 'general_guidance');
create type public.interval_unit as enum ('day', 'week', 'month', 'year');
create type public.source_type as enum (
  'manufacturer_manual',
  'manufacturer_website',
  'similar_model_manual',
  'general_guidance'
);
create type public.task_status as enum ('proposed', 'accepted', 'rejected');

create table public.appliances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  manufacturer text not null check (length(trim(manufacturer)) between 1 and 80),
  model text check (length(model) <= 40),
  serial_number text check (length(serial_number) <= 40),
  -- 0..1 when the owner kept an AI proposal unchanged; null when typed or edited.
  identification_confidence numeric(3, 2) check (identification_confidence between 0 and 1),
  approved_at timestamptz,
  -- First calendar date of every accepted task.
  start_date date,
  created_at timestamptz not null default now(),
  constraint approval_has_start_date check ((approved_at is null) = (start_date is null))
);
create index appliances_user_id_idx on public.appliances (user_id);

create table public.maintenance_tasks (
  id uuid primary key default gen_random_uuid(),
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  position integer not null,
  name text not null check (length(trim(name)) between 1 and 200),
  instructions text not null check (length(instructions) <= 2000),
  interval_count integer not null check (interval_count between 1 and 999),
  interval_unit public.interval_unit not null,
  evidence_level public.evidence_level not null,
  source_type public.source_type not null,
  source_title text not null check (length(trim(source_title)) between 1 and 300),
  source_url text check (source_url ~ '^https://' and length(source_url) <= 2000),
  source_location text check (length(source_location) <= 200),
  source_quote text check (length(source_quote) <= 1000),
  status public.task_status not null default 'proposed',
  calendar_event_id text,
  created_at timestamptz not null default now(),
  unique (appliance_id, position),
  -- Never present inferred or general guidance as manufacturer-verified (handoff §4, §23).
  -- Mirrors unsupportedEvidence() in src/domain/evidence.ts.
  constraint evidence_supported check (
    case evidence_level
      when 'manufacturer_verified' then
        source_type in ('manufacturer_manual', 'manufacturer_website')
        and source_url is not null
        and length(trim(coalesce(source_quote, ''))) > 0
      when 'similar_model' then source_type <> 'general_guidance'
      else true
    end
  )
);
create index maintenance_tasks_appliance_id_idx on public.maintenance_tasks (appliance_id);

-- Proposals are written once; afterwards only the owner's answer and the calendar link change.
create function public.guard_maintenance_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_approved_at timestamptz;
begin
  select approved_at into v_approved_at from public.appliances where id = new.appliance_id;
  if tg_op = 'INSERT' then
    if v_approved_at is not null or new.status <> 'proposed' or new.calendar_event_id is not null then
      raise exception 'tasks are added as proposals, before Approval' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if (new.appliance_id, new.position, new.name, new.instructions, new.interval_count, new.interval_unit,
      new.evidence_level, new.source_type, new.source_title, new.source_url, new.source_location, new.source_quote)
     is distinct from
     (old.appliance_id, old.position, old.name, old.instructions, old.interval_count, old.interval_unit,
      old.evidence_level, old.source_type, old.source_title, old.source_url, old.source_location, old.source_quote) then
    raise exception 'a proposed task is never rewritten; accept or reject it' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and v_approved_at is not null then
    raise exception 'plan already approved; decisions are frozen' using errcode = 'P0001';
  end if;
  if new.calendar_event_id is not null and (new.status <> 'accepted' or v_approved_at is null) then
    raise exception 'only accepted tasks of an approved plan reach a calendar' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger maintenance_tasks_guard
  before insert or update on public.maintenance_tasks
  for each row execute function public.guard_maintenance_task();

-- Approval happens once, when every task is decided and at least one is accepted.
create function public.guard_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.approved_at is not null and new.approved_at is distinct from old.approved_at
     or old.start_date is not null and new.start_date is distinct from old.start_date then
    raise exception 'plan already approved' using errcode = 'P0001';
  end if;
  if old.approved_at is null and new.approved_at is not null then
    if exists (select 1 from public.maintenance_tasks where appliance_id = new.id and status = 'proposed') then
      raise exception 'decide every task before approving' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.maintenance_tasks where appliance_id = new.id and status = 'accepted') then
      raise exception 'accept at least one task before approving' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

create trigger appliances_guard_approval
  before update on public.appliances
  for each row execute function public.guard_approval();

-- Row-level security: an owner sees only their own dishwashers and their tasks.
alter table public.appliances enable row level security;
alter table public.maintenance_tasks enable row level security;

create policy "own appliances" on public.appliances
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- No delete policy: tasks go when their dishwasher is deleted (the foreign key cascades).
create policy "read own tasks" on public.maintenance_tasks
  for select to authenticated
  using (appliance_id in (select id from public.appliances where user_id = (select auth.uid())));
create policy "add own tasks" on public.maintenance_tasks
  for insert to authenticated
  with check (appliance_id in (select id from public.appliances where user_id = (select auth.uid())));
create policy "decide own tasks" on public.maintenance_tasks
  for update to authenticated
  using (appliance_id in (select id from public.appliances where user_id = (select auth.uid())))
  with check (appliance_id in (select id from public.appliances where user_id = (select auth.uid())));

-- Adds a dishwasher with its proposed tasks in one transaction, so a dishwasher never exists
-- without its plan. Runs as the caller: RLS applies to every insert.
create function public.add_appliance(
  p_manufacturer text,
  p_model text,
  p_serial_number text,
  p_identification_confidence numeric,
  p_tasks jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_appliance uuid;
begin
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'a dishwasher needs at least one proposed task' using errcode = '23514';
  end if;

  insert into public.appliances (manufacturer, model, serial_number, identification_confidence)
  values (trim(p_manufacturer), nullif(trim(p_model), ''), nullif(trim(p_serial_number), ''), p_identification_confidence)
  returning id into v_appliance;

  insert into public.maintenance_tasks
    (appliance_id, position, name, instructions, interval_count, interval_unit, evidence_level,
     source_type, source_title, source_url, source_location, source_quote)
  select v_appliance, n::integer, t ->> 'name', t ->> 'instructions', (t ->> 'interval_count')::integer,
         (t ->> 'interval_unit')::public.interval_unit, (t ->> 'evidence_level')::public.evidence_level,
         (t ->> 'source_type')::public.source_type, t ->> 'source_title', t ->> 'source_url',
         t ->> 'source_location', t ->> 'source_quote'
  from jsonb_array_elements(p_tasks) with ordinality as e(t, n);

  return v_appliance;
end;
$$;

-- Beta usage counts (docs/HANDOFF.md §15). Event names and small counts only: no names, models
-- or photos. Visitors can only append their own; reading is for the team (SQL editor).
create table public.funnel_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (name in (
    'scan_started', 'label_read', 'appliance_added', 'plan_proposed', 'plan_approved',
    'calendar_connected', 'calendar_tasks_created'
  )),
  props jsonb not null default '{}' check (jsonb_typeof(props) = 'object' and length(props::text) <= 300),
  occurred_at timestamptz not null default now()
);
create index funnel_events_name_idx on public.funnel_events (name, occurred_at);

alter table public.funnel_events enable row level security;
create policy "append own events" on public.funnel_events
  for insert to authenticated with check (user_id = (select auth.uid()));
revoke select, update, delete on public.funnel_events from anon, authenticated;
