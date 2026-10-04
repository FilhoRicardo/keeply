-- Never present inferred or general guidance as manufacturer-verified (handoff §4).
-- Mirrors unsupportedEvidence() in src/domain/evidence.ts so the rule holds for every writer,
-- including future AI pipelines.
create function public.normalise_model(model text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(model, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create function public.check_recommendation_evidence() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_source_type public.source_type;
  v_model_scope text;
  v_model text;
begin
  select s.source_type, s.model_scope into v_source_type, v_model_scope
  from public.source_documents s where s.id = new.source_document_id;
  select a.model into v_model from public.appliances a where a.id = new.appliance_id;

  if new.evidence_level = 'manufacturer_verified' then
    if v_source_type not in ('manufacturer_manual', 'manufacturer_website') then
      raise exception 'manufacturer_verified needs a manufacturer manual or website source' using errcode = '23514';
    end if;
    if public.normalise_model(v_model) = '' or public.normalise_model(v_model_scope) <> public.normalise_model(v_model) then
      raise exception 'manufacturer_verified needs a source for this exact model' using errcode = '23514';
    end if;
  elsif new.evidence_level = 'similar_model'
    and v_source_type not in ('manufacturer_manual', 'manufacturer_website', 'similar_model_manual') then
    raise exception 'similar_model needs a manufacturer or similar-model source' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger maintenance_recommendations_evidence_supported
  before insert on public.maintenance_recommendations
  for each row execute function public.check_recommendation_evidence();
