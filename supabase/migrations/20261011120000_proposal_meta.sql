-- RF-352: keep the plan banner's reason after a reload.
-- proposal_meta is the proposer's outcome (fallback, search outcome, search reason, searched).
-- Null means the row was saved before this column existed. The app must treat that as unknown
-- provenance and show a neutral banner, never "no manufacturer manual found".
-- The owner applies this to hosted Supabase; do not run it against the hosted project from CI.

alter table public.appliances
  add column proposal_meta jsonb;

alter table public.appliances
  add constraint proposal_meta_shape check (
    proposal_meta is null
    or (
      jsonb_typeof(proposal_meta) = 'object'
      and proposal_meta ?& array['fallback', 'searchOutcome', 'searchReason', 'searched']
      and (proposal_meta - 'fallback' - 'searchOutcome' - 'searchReason' - 'searched') = '{}'::jsonb
      and proposal_meta->>'fallback' in ('exact', 'similar', 'general')
      and proposal_meta->>'searchOutcome' in (
        'ok', 'no_results', 'quota_exhausted', 'fetch_failed', 'extraction_unavailable',
        'unreadable', 'no_text', 'timeout', 'unavailable', 'no_plan'
      )
      and (
        (
          jsonb_typeof(proposal_meta->'searchReason') = 'string'
          and length(proposal_meta->>'searchReason') between 1 and 200
        )
        or proposal_meta->'searchReason' = 'null'::jsonb
      )
      and jsonb_typeof(proposal_meta->'searched') = 'boolean'
    )
  );

-- Provenance is written once, with the proposals. Later updates (Approval, nothing else the
-- owner does here) must not rewrite why the plan was proposed.
create function public.guard_proposal_meta() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.proposal_meta is distinct from old.proposal_meta then
    raise exception 'proposal provenance is never rewritten' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger appliances_guard_proposal_meta
  before update on public.appliances
  for each row execute function public.guard_proposal_meta();

-- Same RPC as 20261005090000_mvp_schema.sql, plus the provenance document.
drop function public.add_appliance(text, text, text, numeric, jsonb);

create function public.add_appliance(
  p_manufacturer text,
  p_model text,
  p_serial_number text,
  p_identification_confidence numeric,
  p_tasks jsonb,
  p_proposal_meta jsonb default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_appliance uuid;
begin
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'a dishwasher needs at least one proposed task' using errcode = '23514';
  end if;

  insert into public.appliances (
    manufacturer, model, serial_number, identification_confidence, proposal_meta
  )
  values (
    trim(p_manufacturer),
    nullif(trim(p_model), ''),
    nullif(trim(p_serial_number), ''),
    p_identification_confidence,
    p_proposal_meta
  )
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

grant execute on function public.add_appliance(text, text, text, numeric, jsonb, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
