import type { CalendarEventDraft } from '@/domain/calendar-event'

// The one thing Keeply asks of a calendar provider. Called only after Approval.
// Create the Task's event, or update it in place if it already exists (same Task, same event),
// so retries never duplicate and a completion-based Task can move to its next due date.
export interface CalendarWriter {
  upsertEvent(draft: CalendarEventDraft): Promise<{ eventId: string }>
  // Removes the Task's event (e.g. when the owner pauses it). Already gone counts as removed.
  deleteEvent(taskId: string): Promise<void>
}

export type WriteResult =
  | { taskId: string; ok: true; eventId: string }
  | { taskId: string; ok: false; error: string }

// Writes each event independently so one failure does not lose the others.
// Writers are idempotent per taskId, so retrying failed tasks is safe.
export async function writeEvents(writer: CalendarWriter, drafts: readonly CalendarEventDraft[]): Promise<WriteResult[]> {
  const results: WriteResult[] = []
  for (const draft of drafts) {
    try {
      const { eventId } = await writer.upsertEvent(draft)
      results.push({ taskId: draft.taskId, ok: true, eventId })
    } catch (error) {
      results.push({ taskId: draft.taskId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}

export type RemoveResult = { taskId: string; ok: true } | { taskId: string; ok: false; error: string }

export async function removeEvents(writer: CalendarWriter, taskIds: readonly string[]): Promise<RemoveResult[]> {
  const results: RemoveResult[] = []
  for (const taskId of taskIds) {
    try {
      await writer.deleteEvent(taskId)
      results.push({ taskId, ok: true })
    } catch (error) {
      results.push({ taskId, ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return results
}
