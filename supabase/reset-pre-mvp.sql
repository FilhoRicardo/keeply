-- One-off: removes the pre-MVP Keeply schema (the nine migrations before 2026-10-05) from a
-- Supabase project, so supabase/migrations/20261005090000_mvp_schema.sql can be applied.
-- Deletes every Keeply row. Only for projects with no real users yet. Not a migration.
drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists on_auth_user_updated on auth.users;

drop policy if exists "owner reads own appliance photos" on storage.objects;
drop policy if exists "owner adds own appliance photos" on storage.objects;
drop policy if exists "owner replaces own appliance photos" on storage.objects;
drop policy if exists "owner removes own appliance photos" on storage.objects;

drop view if exists public.funnel_summary;
drop table if exists
  public.plan_decisions, public.maintenance_completions, public.maintenance_tasks,
  public.maintenance_recommendations, public.source_documents, public.appliances,
  public.homes, public.users, public.funnel_events, public.guidance_catalog
  cascade;

drop function if exists public.handle_new_user();
drop function if exists public.sync_user_profile();
drop function if exists public.owns_appliance(uuid);
drop function if exists public.forbid_recommendation_update();
drop function if exists public.forbid_decisions_after_approval();
drop function if exists public.check_recommendation_evidence();
drop function if exists public.normalise_model(text);
drop function if exists public.add_appliance_with_recommendations(text, text, text, jsonb, jsonb, numeric);

drop type if exists public.decision_kind, public.scheduling_mode, public.task_status,
  public.evidence_level, public.interval_unit, public.source_type;

-- Label photos are no longer stored. Newer Supabase versions refuse direct deletes from storage
-- tables; then delete the "appliance-photos" bucket in the dashboard (Storage).
do $$
begin
  delete from storage.objects where bucket_id = 'appliance-photos';
  delete from storage.buckets where id = 'appliance-photos';
exception when others then
  raise notice 'Delete the appliance-photos bucket in Supabase Storage: %', sqlerrm;
end $$;

-- If the old schema was applied with `supabase db push`, forget those versions so the next push
-- applies the MVP migration.
do $$
begin
  delete from supabase_migrations.schema_migrations where version in (
    '20261004120000', '20261004160000', '20261004170000', '20261004180000', '20261004190000',
    '20261004200000', '20261004210000', '20261004220000', '20261004230000');
exception when undefined_table or invalid_schema_name then
  null;
end $$;
