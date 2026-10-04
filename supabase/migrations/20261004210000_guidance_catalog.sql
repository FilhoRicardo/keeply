-- Curated maintenance guidance: each row checked by a person against a real manufacturer document.
-- Visitors read it to get proposals; only the team (service role / SQL editor) writes it.
-- Ships empty on purpose: never invent manufacturer intervals.
create table public.guidance_catalog (
  id uuid primary key default gen_random_uuid(),
  manufacturer text not null check (length(trim(manufacturer)) > 0),
  -- Exact model ("SMS6ZCI49E") or family prefix ending in "*" ("SMS6*").
  model_scope text not null check (model_scope ~ '^[A-Za-z0-9][A-Za-z0-9 ./-]*\*?$'),
  source_type public.source_type not null check (source_type in ('manufacturer_manual', 'manufacturer_website')),
  title text not null,
  reference text not null check (reference ~ '^https://'),
  source_location text,
  task_name text not null,
  description text not null,
  interval_count integer not null check (interval_count between 1 and 999),
  interval_unit public.interval_unit not null,
  verified_by text not null,
  verified_on date not null,
  created_at timestamptz not null default now()
);
create index guidance_catalog_manufacturer_idx on public.guidance_catalog (upper(manufacturer));

alter table public.guidance_catalog enable row level security;
create policy "anyone signed in reads the catalog" on public.guidance_catalog for select to authenticated using (true);
revoke insert, update, delete on public.guidance_catalog from anon, authenticated;

-- Each proposed recommendation may now carry its own source (catalog entries cite different
-- documents). Recommendations without one use p_source. Identical sources are stored once.
create or replace function public.add_appliance_with_recommendations(
  p_manufacturer text,
  p_model text,
  p_serial_number text,
  p_source jsonb,
  p_recommendations jsonb,
  p_identification_confidence numeric default null
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare
  v_home uuid;
  v_appliance uuid;
  v_source uuid;
  v_sources jsonb := '{}';
  v_source_json jsonb;
  v_rec jsonb;
  v_position bigint;
begin
  select id into v_home from public.homes where user_id = (select auth.uid()) order by created_at limit 1;
  if v_home is null then
    insert into public.homes (user_id) values ((select auth.uid())) returning id into v_home;
  end if;

  insert into public.appliances (home_id, manufacturer, model, serial_number, identification_confidence)
  values (v_home, p_manufacturer, nullif(trim(p_model), ''), nullif(trim(p_serial_number), ''), p_identification_confidence)
  returning id into v_appliance;

  for v_rec, v_position in select r, n from jsonb_array_elements(p_recommendations) with ordinality as e(r, n) loop
    v_source_json := coalesce(v_rec -> 'source', p_source);
    if v_sources ? (v_source_json::text) then
      v_source := (v_sources ->> (v_source_json::text))::uuid;
    else
      insert into public.source_documents (appliance_id, source_type, title, reference, manufacturer, model_scope)
      values (
        v_appliance,
        (v_source_json ->> 'source_type')::public.source_type,
        v_source_json ->> 'title',
        v_source_json ->> 'reference',
        v_source_json ->> 'manufacturer',
        v_source_json ->> 'model_scope'
      )
      returning id into v_source;
      v_sources := v_sources || jsonb_build_object(v_source_json::text, v_source);
    end if;

    insert into public.maintenance_recommendations
      (appliance_id, task_name, description, recommended_interval_count, recommended_interval_unit,
       evidence_level, source_document_id, source_location, position)
    values (
      v_appliance, v_rec ->> 'task_name', v_rec ->> 'description', (v_rec ->> 'interval_count')::integer,
      (v_rec ->> 'interval_unit')::public.interval_unit, (v_rec ->> 'evidence_level')::public.evidence_level,
      v_source, v_rec ->> 'source_location', v_position::integer
    );
  end loop;

  return v_appliance;
end;
$$;
