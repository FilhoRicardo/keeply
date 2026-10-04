import type { CalendarEventDraft } from '@/domain/calendar-event'

// The one thing Keeply asks of a calendar provider. Called only after Approval.
// Create the task's event, or update it in place if it already exists (same task, same event),
// so retries never duplicate.
export interface CalendarWriter {
  upsertEvent(draft: CalendarEventDraft): Promise<{ eventId: string }>
}

export type WriteResult =
  | { taskId: string; ok: true; eventId: string }
  | { taskId: string; ok: false; error: string }

// Runs one calendar call per task concurrently; a failure is reported for that task only.
async function perTask<T>(taskIds: readonly string[], call: (index: number) => Promise<T>) {
  return Promise.all(
    taskIds.map(async (taskId, i) => {
      try {
        return { taskId, ok: true as const, value: await call(i) }
      } catch (error) {
        return { taskId, ok: false as const, error: error instanceof Error ? error.message : String(error) }
      }
    }),
  )
}

// Writes each event independently so one failure does not lose the others.
// Writers are idempotent per taskId, so retrying failed tasks is safe.
export async function writeEvents(writer: CalendarWriter, drafts: readonly CalendarEventDraft[]): Promise<WriteResult[]> {
  const results = await perTask(
    drafts.map((d) => d.taskId),
    (i) => writer.upsertEvent(drafts[i]),
  )
  return results.map((r) => (r.ok ? { taskId: r.taskId, ok: true, eventId: r.value.eventId } : r))
}
