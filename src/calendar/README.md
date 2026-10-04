# src/calendar

Calendar adapters behind the `CalendarWriter` interface (`writer.ts`). Nothing may be written to a calendar before Approval.

- `google.ts`: Google Calendar writer and OAuth helpers. Scope is `calendar.events` only, online access, no refresh token stored.
- Event ids are derived from the Task id. Writes are upserts: a 409 on insert becomes an update, so retries never duplicate and a completion-based Task's event moves to its next due date.
- `writeEvents` writes each approved task independently and reports per-task results.
