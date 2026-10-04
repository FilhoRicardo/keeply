-- Phase 2 groundwork: private photos of the appliance label, one folder per owner.
insert into storage.buckets (id, name, public)
values ('appliance-photos', 'appliance-photos', false)
on conflict (id) do nothing;

create policy "owner reads own appliance photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'appliance-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owner adds own appliance photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'appliance-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owner replaces own appliance photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'appliance-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "owner removes own appliance photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'appliance-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- The add-appliance RPC now records a recogniser's confidence (null when typed by the owner).
drop function public.add_appliance_with_recommendations(text, text, text, jsonb, jsonb);

create function public.add_appliance_with_recommendations(
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
begin
  select id into v_home from public.homes where user_id = (select auth.uid()) order by created_at limit 1;
  if v_home is null then
    insert into public.homes (user_id) values ((select auth.uid())) returning id into v_home;
  end if;

  insert into public.appliances (home_id, manufacturer, model, serial_number, identification_confidence)
  values (v_home, p_manufacturer, nullif(trim(p_model), ''), nullif(trim(p_serial_number), ''), p_identification_confidence)
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
