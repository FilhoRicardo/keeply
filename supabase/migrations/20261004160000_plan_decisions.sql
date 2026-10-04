-- Include / Customise / Skip choices made before Approval. They are a draft: Tasks are only
-- created by the Approval action, and decisions are frozen once any Task exists.

-- Display order of proposed recommendations (rows created together share a timestamp).
alter table public.maintenance_recommendations add column position integer not null default 0;

create type public.decision_kind as enum ('include', 'customise', 'skip');

create table public.plan_decisions (
  recommendation_id uuid primary key,
  appliance_id uuid not null references public.appliances (id) on delete cascade,
  kind public.decision_kind not null,
  interval_count integer check (interval_count between 1 and 999),
  interval_unit public.interval_unit,
  start_date date,
  scheduling_mode public.scheduling_mode,
  updated_at timestamptz not null default now(),
  foreign key (recommendation_id, appliance_id)
    references public.maintenance_recommendations (id, appliance_id) on delete cascade,
  constraint customise_has_schedule check (
    (kind = 'customise') = (interval_count is not null and interval_unit is not null
      and start_date is not null and scheduling_mode is not null)
  )
);
create index plan_decisions_appliance_id_idx on public.plan_decisions (appliance_id);

create function public.forbid_decisions_after_approval() returns trigger
language plpgsql as $$
declare
  target uuid := coalesce(new.appliance_id, old.appliance_id);
begin
  -- Deleting the appliance itself cascades here; let it through.
  if tg_op = 'DELETE' and not exists (select 1 from public.appliances where id = target) then
    return old;
  end if;
  if exists (select 1 from public.maintenance_tasks where appliance_id = target) then
    raise exception 'plan already approved; decisions are frozen' using errcode = 'P0001';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger plan_decisions_frozen_after_approval
  before insert or update or delete on public.plan_decisions
  for each row execute function public.forbid_decisions_after_approval();

alter table public.plan_decisions enable row level security;

create policy "own decisions" on public.plan_decisions
  for all to authenticated using (public.owns_appliance(appliance_id)) with check (public.owns_appliance(appliance_id));

-- Creates a manually entered dishwasher with its source and proposed recommendations in one
-- transaction, so an appliance never exists without provenance-backed recommendations.
-- Runs as the caller: RLS still applies to every insert.
create function public.add_appliance_with_recommendations(
  p_manufacturer text,
  p_model text,
  p_serial_number text,
  p_source jsonb,
  p_recommendations jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_home uuid;
  v_appliance uuid;
  v_source uuid;
begin
  select id into v_home from public.homes where user_id = (select auth.uid()) order by created_at limit 1;
  if v_home is null then
    insert into public.homes (user_id) values ((select auth.uid())) returning id into v_home;
  end if;

  insert into public.appliances (home_id, manufacturer, model, serial_number)
  values (v_home, p_manufacturer, nullif(trim(p_model), ''), nullif(trim(p_serial_number), ''))
  returning id into v_appliance;

  insert into public.source_documents (appliance_id, source_type, title, reference, manufacturer, model_scope)
  values (
    v_appliance,
    (p_source ->> 'source_type')::public.source_type,
    p_source ->> 'title',
    p_source ->> 'reference',
    p_source ->> 'manufacturer',
    p_source ->> 'model_scope'
  )
  returning id into v_source;

  insert into public.maintenance_recommendations
    (appliance_id, task_name, description, recommended_interval_count, recommended_interval_unit,
     evidence_level, source_document_id, source_location, position)
  select v_appliance, r ->> 'task_name', r ->> 'description', (r ->> 'interval_count')::integer,
         (r ->> 'interval_unit')::public.interval_unit, (r ->> 'evidence_level')::public.evidence_level,
         v_source, r ->> 'source_location', n::integer
  from jsonb_array_elements(p_recommendations) with ordinality as e(r, n);

  return v_appliance;
end;
$$;
