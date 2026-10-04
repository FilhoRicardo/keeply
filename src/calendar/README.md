# src/calendar

Calendar adapters behind the `CalendarWriter` interface (`writer.ts`). Nothing may be written to a calendar before Approval, and only accepted tasks are written.

- `google.ts`: Google Calendar writer and OAuth helpers. Scope is `calendar.events` only, online access, no refresh token stored.
- Event ids are derived from the task id. Writes are upserts: a 409 on insert becomes an update, so retries never duplicate.
- `writeEvents` writes each accepted task independently and reports per-task results. After that the owner manages the events in their calendar; Keeply does not change or remove them.
