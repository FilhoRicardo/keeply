-- RF-352: the plan reason is stored with the appliance and is not rewritten later.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(12);

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.com');

create function pg_temp.act_as(uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
$$;

create function pg_temp.task(name text, level text, type text, url text, quote text) returns jsonb language sql as $$
  select jsonb_build_object('name', name, 'instructions', 'Do it.', 'interval_count', 1, 'interval_unit', 'month',
    'evidence_level', level, 'source_type', type, 'source_title', 'Source', 'source_url', url, 'source_quote', quote) $$;

-- Reads the row in a later statement than the insert, so the new appliance is visible.
create function pg_temp.stored(fallback text, outcome text, reason text, searched boolean, task jsonb) returns text
language plpgsql as $$
declare
  v_id uuid;
  stored text;
begin
  v_id := add_appliance('Bosch', 'SMS6', '', null, jsonb_build_array(task), fallback, outcome, reason, searched);
  select case
    when proposal_fallback is null and proposal_search_outcome is null
     and proposal_search_reason is null and proposal_searched is null then 'empty'
    else proposal_fallback || '|' || proposal_search_outcome || '|' || coalesce(proposal_search_reason, '') || '|' || proposal_searched::text
  end into stored from appliances where appliances.id = v_id;
  return stored;
end $$;

create function pg_temp.stored_without_reason() returns text language plpgsql as $$
declare
  v_id uuid;
  stored text;
begin
  v_id := add_appliance('Bosch', null, null, null,
    jsonb_build_array(pg_temp.task('Clean', 'general_guidance', 'general_guidance', null, null)));
  select case
    when proposal_fallback is null and proposal_search_outcome is null
     and proposal_search_reason is null and proposal_searched is null then 'empty'
    else 'present'
  end into stored from appliances where appliances.id = v_id;
  return stored;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-00000000000a');

select is(pg_temp.stored('exact', 'ok', null, true, pg_temp.task('Clean', 'general_guidance', 'general_guidance', null, null)),
  'exact|ok||true', 'a verified plan stores its reason');
select is(pg_temp.stored('similar', 'ok', null, true, pg_temp.task('Clean', 'similar_model', 'similar_model_manual', 'https://www.smeg.com/m.pdf', 'Clean it.')),
  'similar|ok||true', 'a similar-model plan stores its reason');
select is(pg_temp.stored('general', 'no_results', 'no_key', true, pg_temp.task('Clean', 'general_guidance', 'general_guidance', null, null)),
  'general|no_results|no_key|true', 'a general-guidance plan stores its reason');
select is(pg_temp.stored('general', 'extraction_unavailable', null, true, pg_temp.task('Clean', 'general_guidance', 'general_guidance', null, null)),
  'general|extraction_unavailable||true', 'an unreadable-manual plan stores its reason');
select is(pg_temp.stored('general', 'timeout', null, true, pg_temp.task('Clean', 'general_guidance', 'general_guidance', null, null)),
  'general|timeout||true', 'a timed-out plan stores its reason');
select is(pg_temp.stored_without_reason(), 'empty', 'a save without a reason leaves the columns empty');

select throws_ok($$ select add_appliance('Bosch', null, null, null,
  jsonb_build_array(pg_temp.task('Clean', 'general_guidance', 'general_guidance', null, null)),
  'verified', 'ok', null, true) $$, '23514', null, 'an unknown fallback is rejected');

select throws_ok($$ select add_appliance('Bosch', null, null, null,
  jsonb_build_array(pg_temp.task('Clean', 'general_guidance', 'general_guidance', null, null)),
  'general', null, null, null) $$, '23514', null, 'a partial reason is rejected');

select throws_ok($$ update appliances set proposal_search_outcome = 'no_results' where proposal_fallback = 'exact' $$,
  'P0001', null, 'a saved plan reason is never rewritten');

select lives_ok($$ update maintenance_tasks set status = 'accepted'
  where appliance_id = (select id from appliances where proposal_fallback = 'exact') $$,
  'the owner can still accept a task');

select lives_ok($$ update appliances set approved_at = now(), start_date = '2026-10-11' where proposal_fallback = 'exact' $$,
  'approval does not rewrite the plan reason');

select is(
  (select proposal_fallback || '|' || proposal_search_outcome from appliances where proposal_fallback = 'exact'),
  'exact|ok',
  'the reason is unchanged after approval');

select * from finish();
rollback;
