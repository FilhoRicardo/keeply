import { toCalendarEvent, type CalendarEventDraft } from '@/domain/calendar-event'
import type { Task } from '@/domain/model'
import { calendarBound } from '@/domain/plan'
import type { ApplianceRecord } from './plan-state'

// Calendar drafts for the given tasks of an approved plan. Skipped, unknown or unapproved
// tasks are dropped: nothing reaches a calendar before Approval.
export function draftsForTasks(record: ApplianceRecord, tasks: readonly Pick<Task, 'id'>[]): CalendarEventDraft[] {
  if (!record.approvedAt) throw new Error('Approve the plan before writing to a calendar.')
  const wanted = new Set(tasks.map((t) => t.id))
  return calendarBound(record.tasks)
    .filter((t) => wanted.has(t.id))
    .map((task) => {
      const rec = record.recommendations.find((r) => r.id === task.recommendationId)!
      return toCalendarEvent(task, rec, record.appliance, record.completions)
    })
}
