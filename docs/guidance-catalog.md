# Guidance catalog

Curated maintenance guidance, checked by a person against a real manufacturer document. It is how Keeply proposes Manufacturer verified or Similar-model guidance before any AI exists. Table: `public.guidance_catalog` (migration `20261004210000_guidance_catalog.sql`). It ships empty: never invent intervals.

## How an entry is used

When an owner adds a dishwasher, Keeply loads the entries for its manufacturer and matches the model (case, spaces and punctuation ignored):

| Entry `model_scope` | Owner's model | Proposed as |
|---|---|---|
| `SMS6ZCI49E` (exact) | `SMS6ZCI49E` | **Manufacturer verified** |
| `SMS6*` (family prefix) | `SMS6ECI03E` | **Similar-model guidance** |
| no match / no model | any | General guidance (the three default tasks) |

Exact entries win over family entries. The evidence guard (`unsupportedEvidence` and the database trigger) still checks every recommendation, so a wrong entry cannot be shown as verified.

## Adding an entry

Use the Supabase SQL editor (visitors cannot write this table). One row per task:

```sql
insert into public.guidance_catalog
  (manufacturer, model_scope, source_type, title, reference, source_location,
   task_name, description, interval_count, interval_unit, verified_by, verified_on)
values
  ('<Manufacturer>', '<exact model or FAMILY*>', 'manufacturer_manual',
   '<document title>', 'https://<link to the document>', '<page or section>',
   '<task name as the owner should read it>', '<one or two plain sentences>',
   <count>, '<day|week|month|year>', '<your name>', current_date);
```

Rules:
- Copy the interval exactly as the document states it. If the document gives none, do not add the task here.
- `reference` must be a public https link to the manufacturer's own document or page.
- Use a family prefix only when the document itself says it covers that range.
- Existing appliances keep the recommendations they were given (recommendations are never rewritten); new appliances get the new entries.
