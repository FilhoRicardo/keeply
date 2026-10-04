-- Completions are real past events with short notes. One day of slack covers time zones ahead of UTC.
alter table public.maintenance_completions
  add constraint completion_not_in_future check (completed_on <= (now() at time zone 'utc')::date + 1),
  add constraint completion_note_short check (notes is null or length(notes) <= 280);
