-- Run with `supabase test db`. Evidence levels must be backed by their source.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(5);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.com');
insert into public.appliances (id, home_id, manufacturer, model)
select '10000000-0000-0000-0000-000000000001', id, 'Bosch', 'SMS6ZCI49E' from public.homes;

insert into public.source_documents (id, appliance_id, source_type, title, model_scope) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'manufacturer_manual', 'Manual', 'sms6zci-49e'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'manufacturer_manual', 'Other manual', 'SMS4HVI33E'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'general_guidance', 'General', null);

create function pg_temp.rec(source text, level text) returns void language sql as $$
  insert into public.maintenance_recommendations
    (appliance_id, task_name, description, recommended_interval_count, recommended_interval_unit, evidence_level, source_document_id)
  values ('10000000-0000-0000-0000-000000000001', 'Clean filter', 'Rinse', 1, 'month', level::public.evidence_level, source::uuid) $$;

select lives_ok($$ select pg_temp.rec('20000000-0000-0000-0000-000000000001', 'manufacturer_verified') $$,
  'verified with an exact-model manufacturer manual');
select throws_ok($$ select pg_temp.rec('20000000-0000-0000-0000-000000000002', 'manufacturer_verified') $$,
  '23514', null, 'verified with another model''s manual is rejected');
select throws_ok($$ select pg_temp.rec('20000000-0000-0000-0000-000000000003', 'manufacturer_verified') $$,
  '23514', null, 'verified with general guidance is rejected');
select throws_ok($$ select pg_temp.rec('20000000-0000-0000-0000-000000000003', 'similar_model') $$,
  '23514', null, 'similar-model with general guidance is rejected');
select lives_ok($$ select pg_temp.rec('20000000-0000-0000-0000-000000000003', 'general_guidance') $$,
  'general guidance from a general source');

select * from finish();
rollback;
