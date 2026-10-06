import { addInterval, type LocalDate } from './dates'
import { evidenceLabel } from './evidence'
import { formatInterval } from './format-interval'
import type { Appliance, ApplianceRecord, MaintenanceTask } from './model'
import { calendarBound } from './plan'
import { toRRule } from './recurrence'

// A provider-neutral all-day recurring calendar event. Adapters in src/calendar translate it.
export type CalendarEventDraft = {
  taskId: string
  summary: string
  description: string
  date: LocalDate
  // Exclusive end date, as calendar APIs expect for all-day events.
  endDate: LocalDate
  recurrence: string[]
}

export function applianceName(appliance: Pick<Appliance, 'manufacturer' | 'model'>): string {
  return [appliance.manufacturer, appliance.model].filter(Boolean).join(' ').trim()
}

// One recurring event per accepted task, from the plan's start date. After this the owner
// manages it in their calendar.
export function toCalendarEvent(task: MaintenanceTask, appliance: Appliance, startDate: LocalDate): CalendarEventDraft {
  if (task.status !== 'accepted') throw new Error('Only accepted tasks may reach a calendar.')
  if (task.applianceId !== appliance.id) throw new Error('Task and appliance do not match.')

  const { source } = task
  const description = [
    task.instructions,
    '',
    `${formatInterval(task.interval)} · ${evidenceLabel(task.evidenceLevel)}`,
    `Source: ${[source.title, source.location].filter(Boolean).join(', ')}`,
    ...(source.quote ? [`“${source.quote}”`] : []),
    ...(source.url ? [source.url] : []),
    '',
    'Added by Keeply after you approved this task.',
  ].join('\n')

  return {
    taskId: task.id,
    summary: `${task.name} · ${applianceName(appliance)}`,
    description,
    date: startDate,
    endDate: addInterval(startDate, { count: 1, unit: 'day' }),
    recurrence: [toRRule(task.interval, startDate)],
  }
}

// Drafts for the given tasks of an approved plan. Rejected, unknown or unapproved tasks are
// dropped: nothing reaches a calendar before Approval.
export function draftsForTasks(record: ApplianceRecord, taskIds: readonly string[]): CalendarEventDraft[] {
  if (!record.approvedAt || !record.startDate) throw new Error('Approve the plan before writing to a calendar.')
  const wanted = new Set(taskIds)
  return calendarBound(record)
    .filter((t) => wanted.has(t.id))
    .map((t) => toCalendarEvent(t, record.appliance, record.startDate!))
}
