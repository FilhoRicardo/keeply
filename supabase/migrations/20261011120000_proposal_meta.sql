-- RF-352: persist the proposer's outcome on the appliance so a signed-in owner who
-- reloads a plan sees the same banner and reason. Columns stay null on appliances
-- saved before this migration; the app treats that as "no saved reason" and shows
-- a neutral banner, never "no manual found".
--
-- The owner applies this on hosted Supabase before deploying the app that sends
-- the new add_appliance arguments. Do not apply it from the app or from CI.
-- The previous 5-argument add_appliance still works (the new arguments default
-- to null), so the current app keeps saving plans once this migration is applied.

alter table public.appliances
  add column proposal_fallback text,
  add column proposal_search_outcome text,
  add column proposal_search_reason text,
  add column proposal_searched boolean;

alter table public.appliances
  add constraint proposal_fallback_known
    check (proposal_fallback is null or proposal_fallback in ('exact', 'similar', 'general')),
  add constraint proposal_search_outcome_known
    check (proposal_search_outcome is null or proposal_search_outcome in (
      'ok', 'no_results', 'quota_exhausted', 'fetch_failed', 'extraction_unavailable',
      'unreadable', 'no_text', 'timeout', 'unavailable', 'no_plan'
    )),
  add constraint proposal_search_reason_length
    check (proposal_search_reason is null or length(proposal_search_reason) <= 200),
  add constraint proposal_meta_complete check (
    (
      proposal_fallback is null
      and proposal_search_outcome is null
      and proposal_search_reason is null
      and proposal_searched is null
    )
    or (
      proposal_fallback is not null
      and proposal_search_outcome is not null
      and proposal_searched is not null
    )
  );

-- The reason is written once, with the plan. Approval may still set the date.
create or replace function public.guard_approval() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.proposal_fallback is distinct from old.proposal_fallback
     or new.proposal_search_outcome is distinct from old.proposal_search_outcome
     or new.proposal_search_reason is distinct from old.proposal_search_reason
     or new.proposal_searched is distinct from old.proposal_searched then
    raise exception 'a plan reason is never rewritten' using errcode = 'P0001';
  end if;
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

drop function public.add_appliance(text, text, text, numeric, jsonb);

-- Same transaction as the tasks. The four reason arguments default to null so a
-- caller that has not been updated yet still creates the appliance.
create function public.add_appliance(
  p_manufacturer text,
  p_model text,
  p_serial_number text,
  p_identification_confidence numeric,
  p_tasks jsonb,
  p_proposal_fallback text default null,
  p_proposal_search_outcome text default null,
  p_proposal_search_reason text default null,
  p_proposal_searched boolean default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_appliance uuid;
begin
  if jsonb_typeof(p_tasks) <> 'array' or jsonb_array_length(p_tasks) = 0 then
    raise exception 'a dishwasher needs at least one proposed task' using errcode = '23514';
  end if;

  insert into public.appliances (
    manufacturer, model, serial_number, identification_confidence,
    proposal_fallback, proposal_search_outcome, proposal_search_reason, proposal_searched
  )
  values (
    trim(p_manufacturer), nullif(trim(p_model), ''), nullif(trim(p_serial_number), ''), p_identification_confidence,
    p_proposal_fallback, p_proposal_search_outcome, nullif(p_proposal_search_reason, ''), p_proposal_searched
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

grant execute on function public.add_appliance(text, text, text, numeric, jsonb, text, text, text, boolean) to authenticated;
