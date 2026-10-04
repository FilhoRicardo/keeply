-- Run with `supabase test db`. The catalog is read-only for visitors and must cite real documents.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(6);

select throws_ok(
  $$ insert into public.guidance_catalog (manufacturer, model_scope, source_type, title, reference, task_name, description,
       interval_count, interval_unit, verified_by, verified_on)
     values ('Bosch', 'SMS6*', 'general_guidance', 'T', 'https://example.com', 'Task', 'D', 1, 'month', 'Ricardo', '2026-10-04') $$,
  '23514', null, 'catalog entries must cite a manufacturer document'
);

select throws_ok(
  $$ insert into public.guidance_catalog (manufacturer, model_scope, source_type, title, reference, task_name, description,
       interval_count, interval_unit, verified_by, verified_on)
     values ('Bosch', 'SMS6*', 'manufacturer_manual', 'T', 'not a url', 'Task', 'D', 1, 'month', 'Ricardo', '2026-10-04') $$,
  '23514', null, 'catalog entries need an https reference'
);

insert into public.guidance_catalog (manufacturer, model_scope, source_type, title, reference, task_name, description,
  interval_count, interval_unit, verified_by, verified_on)
values ('Bosch', 'SMS6*', 'manufacturer_manual', 'Fixture manual', 'https://example.com/m.pdf', 'Task', 'D', 1, 'month', 'Test', '2026-10-04');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.com');
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-00000000000a"}';

select is((select count(*) from public.guidance_catalog)::int, 1, 'signed-in visitors can read the catalog');

select throws_ok(
  $$ insert into public.guidance_catalog (manufacturer, model_scope, source_type, title, reference, task_name, description,
       interval_count, interval_unit, verified_by, verified_on)
     values ('Bosch', 'SMS6*', 'manufacturer_manual', 'T', 'https://x', 'Task', 'D', 1, 'month', 'me', '2026-10-04') $$,
  '42501', null, 'visitors cannot write the catalog'
);

-- One RPC call, two recommendations citing two sources, one citing the default.
select lives_ok(
  $$ select public.add_appliance_with_recommendations('Bosch', 'SMS6ZCI49E', '',
       '{"source_type": "general_guidance", "title": "General"}',
       '[{"task_name": "A", "description": "a", "interval_count": 1, "interval_unit": "month", "evidence_level": "similar_model",
          "source": {"source_type": "manufacturer_manual", "title": "Family manual", "model_scope": "SMS6*"}},
         {"task_name": "B", "description": "b", "interval_count": 3, "interval_unit": "month", "evidence_level": "similar_model",
          "source": {"source_type": "manufacturer_manual", "title": "Family manual", "model_scope": "SMS6*"}},
         {"task_name": "C", "description": "c", "interval_count": 1, "interval_unit": "year", "evidence_level": "general_guidance"}]') $$,
  'recommendations can cite their own sources'
);

select is((select count(*) from public.source_documents)::int, 2, 'identical sources are stored once');

select * from finish();
rollback;
