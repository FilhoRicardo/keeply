-- RF-352: proposal provenance survives a save, and a row without it stays unknown.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@example.com');

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create function pg_temp.task(level text, type text) returns jsonb language sql as $$
  select jsonb_build_object(
    'name', 'Clean the filter', 'instructions', 'Do it.', 'interval_count', 1, 'interval_unit', 'month',
    'evidence_level', level, 'source_type', type, 'source_title', 'Source',
    'source_url', case when type = 'general_guidance' then null else 'https://example.com/manual.pdf' end,
    'source_quote', case when level = 'general_guidance' then null else 'Clean the filter.' end)
$$;

create function pg_temp.meta(fallback text, outcome text, reason text, searched boolean) returns jsonb language sql as $$
  select jsonb_build_object(
    'fallback', fallback, 'searchOutcome', outcome, 'searchReason', reason, 'searched', searched)
$$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select lives_ok($$
  select add_appliance('Bosch', 'OLD', null, null, jsonb_build_array(pg_temp.task('general_guidance', 'general_guidance')))
$$, 'a plan saved without provenance still works');
select results_eq(
  $$ select proposal_meta is null from appliances where model = 'OLD' $$,
  $$ values (true) $$,
  'an older save leaves provenance unknown'
);

select lives_ok($$
  select add_appliance('Bosch', 'VERIFIED', null, null,
    jsonb_build_array(pg_temp.task('manufacturer_verified', 'manufacturer_manual')),
    pg_temp.meta('exact', 'ok', null, true))
$$, 'a manufacturer-verified plan stores its outcome');
select results_eq(
  $$ select proposal_meta->>'fallback', proposal_meta->>'searchOutcome' from appliances where model = 'VERIFIED' $$,
  $$ values ('exact'::text, 'ok'::text) $$,
  'verified provenance is an exact match'
);

select lives_ok($$
  select add_appliance('Smeg', 'SIMILAR', null, null,
    jsonb_build_array(pg_temp.task('similar_model', 'similar_model_manual')),
    pg_temp.meta('similar', 'ok', null, true))
$$, 'a similar-model plan stores its outcome');
select results_eq(
  $$ select proposal_meta->>'fallback' from appliances where model = 'SIMILAR' $$,
  $$ values ('similar'::text) $$,
  'similar-model provenance stays similar'
);

select lives_ok($$
  select add_appliance('Bosch', 'GENERAL', null, null,
    jsonb_build_array(pg_temp.task('general_guidance', 'general_guidance')),
    pg_temp.meta('general', 'no_results', null, true))
$$, 'a general-guidance plan stores no_results');
select lives_ok($$
  select add_appliance('Bosch', 'UNREAD', null, null,
    jsonb_build_array(pg_temp.task('general_guidance', 'general_guidance')),
    pg_temp.meta('general', 'extraction_unavailable', null, true))
$$, 'an unreadable-manual plan stores extraction_unavailable');
select lives_ok($$
  select add_appliance('Bosch', 'TIMEOUT', null, null,
    jsonb_build_array(pg_temp.task('general_guidance', 'general_guidance')),
    pg_temp.meta('general', 'timeout', 'timeout', true))
$$, 'a timed-out plan stores timeout');
select results_eq(
  $$ select model, proposal_meta->>'searchOutcome' from appliances where model in ('GENERAL', 'UNREAD', 'TIMEOUT') order by model $$,
  $$ values ('GENERAL'::text, 'no_results'::text), ('TIMEOUT', 'timeout'), ('UNREAD', 'extraction_unavailable') $$,
  'general, unread and timeout reasons are the ones that were saved'
);

select throws_ok($$
  select add_appliance('Bosch', 'PARTIAL', null, null,
    jsonb_build_array(pg_temp.task('general_guidance', 'general_guidance')),
    '{"fallback":"general"}'::jsonb)
$$, '23514', null, 'a partial provenance document is rejected');
select throws_ok($$
  select add_appliance('Bosch', 'EXTRA', null, null,
    jsonb_build_array(pg_temp.task('general_guidance', 'general_guidance')),
    (pg_temp.meta('general', 'timeout', 'timeout', true) || '{"note":"no"}'::jsonb))
$$, '23514', null, 'provenance cannot carry extra fields');
select throws_ok($$
  select add_appliance('Bosch', 'BADOUT', null, null,
    jsonb_build_array(pg_temp.task('general_guidance', 'general_guidance')),
    pg_temp.meta('general', 'made_up', null, true))
$$, '23514', null, 'an unknown search outcome is rejected');

select throws_ok($$
  update appliances set proposal_meta = pg_temp.meta('exact', 'ok', null, true) where model = 'GENERAL'
$$, 'P0001', null, 'proposal provenance is never rewritten');

update maintenance_tasks set status = 'accepted'
  where appliance_id = (select id from appliances where model = 'TIMEOUT');
select lives_ok($$
  update appliances set approved_at = now(), start_date = '2026-10-11' where model = 'TIMEOUT'
$$, 'approval leaves the saved reason in place');
select results_eq(
  $$ select proposal_meta->>'searchOutcome' from appliances where model = 'TIMEOUT' $$,
  $$ values ('timeout'::text) $$,
  'the timeout reason is still there after approval'
);

select * from finish();
rollback;
