# src/calendar

Calendar adapters behind the `CalendarWriter` interface (`writer.ts`). Nothing may be written to a calendar before Approval.

- `google.ts`: Google Calendar writer and OAuth helpers. Scope is `calendar.events` only, online access, no refresh token stored.
- Event ids are derived from the Task id, so a retried write returns 409 instead of creating a duplicate.
- `writeEvents` writes each approved task independently and reports per-task results.
