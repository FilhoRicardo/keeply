# Data model

Schema lives in `supabase/migrations/`; tests in `supabase/tests/database/` (`supabase db reset && supabase test db`). Types: `src/db/types.ts` (`supabase gen types typescript --local`). Every table has RLS; anonymous Supabase users are role `authenticated` and get the same policies as linked users. Nothing is keyed to email, so linking Google later keeps the same `auth.users.id`.

**profiles** — one row per `auth.users.id`, created by a trigger on sign-up (anonymous included). Owner can select and update their own row. Replaces the handoff's `users`.

**homes** — `user_id → profiles`. RLS: a user selects, inserts and updates only homes where `user_id = auth.uid()`. Root of the ownership chain for every table below.

**appliances** — `home_id → homes`. `category` check = `'dishwasher'` (dishwashers only). RLS via the owning home, on both `using` and `with check`, so an Appliance cannot be moved into another user's home.

**source_documents** — provenance, first class. `source_type` check includes `demo_fixture`. `unique (id, appliance_id)` lets a Recommendation cite only a source of its own Appliance. Select and insert only.

**maintenance_recommendations** — what a source says; never edited. Constraints: `evidence_level` enum rejects anything but the three levels; exactly one of (`interval_count` + `interval_unit`) or `trigger_condition` (`recommendation_interval_xor_condition`); `manufacturer_verified` requires a `source_document_id` so unsourced guidance cannot look verified. Immutability in three layers: no UPDATE policy, `update` privilege revoked from `authenticated` and `anon`, and a `before update` trigger that rejects any change (covers service role and superuser). Select and insert only.

**maintenance_tasks** — what the owner approved. Has its own `user_interval_count/unit` and `start_date`, separate from the Recommendation, which is never touched. `(recommendation_id, appliance_id)` is a composite FK so a Task cannot point at another Appliance's Recommendation. `task_mode_matches_interval`: `condition_based` ⇔ no user interval; `fixed_calendar` and `completion_based` need one. `task_interval_complete`: count and unit come together. `task_calendar_event_needs_approval`: `calendar_event_id` only when `status = 'approved'` and `approved_at` is set, so nothing reaches a calendar before Approval; leaving `approved` (skip, pause, remove) means clearing it first. `approved_at` is set on every (re-)Approval by the app. `removed` = the owner removed an approved Task. Select, insert and update; no delete.

**maintenance_completions** — `completed_at` and `notes` per Task. Input to completion-based next due, which is derived in the domain and never stored. Indexed on `(maintenance_task_id, completed_at)` so completions read in order. Select and insert only.

**funnel_events** — `user_id`, optional `appliance_id`, `name`, `props jsonb`. `name` is checked against the funnel list (the nine measures in handoff §15). RLS: insert only, and only with your own `user_id` and your own Appliance; there is no SELECT, UPDATE or DELETE policy, so clients read nothing back.

Out of scope here: Google token storage and calendar sync state (KEE-11).
