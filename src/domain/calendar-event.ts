import { addInterval, type LocalDate } from './dates'
import { evidenceLabel } from './evidence'
import { formatInterval } from './format-interval'
import type { Appliance, Completion, Recommendation, Task } from './model'
import { toRRule } from './recurrence'
import { nextDue } from './schedule'

// A provider-neutral all-day calendar event. Adapters in src/calendar translate it.
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
  return [appliance.manufacturer, appliance.model].filter(Boolean).join(' ') + ' dishwasher'
}

// fixed_calendar tasks become one recurring event. completion_based tasks become a single
// event on the next due date, rescheduled when the owner records a completion.
export function toCalendarEvent(
  task: Task,
  recommendation: Recommendation,
  appliance: Appliance,
  completions: readonly Completion[] = [],
): CalendarEventDraft {
  if (task.status !== 'approved') throw new Error('Only approved tasks may reach a calendar.')
  if (task.recommendationId !== recommendation.id) throw new Error('Task and recommendation do not match.')

  const date = nextDue(task, completions)
  const source = [recommendation.source.title, recommendation.sourceLocation].filter(Boolean).join(', ')
  const description = [
    recommendation.description,
    '',
    `Your schedule: ${formatInterval(task.userInterval)}${task.schedulingMode === 'completion_based' ? ' after each completion' : ''}`,
    `Recommendation: ${formatInterval(recommendation.recommendedInterval)} (${evidenceLabel(recommendation.evidenceLevel)})`,
    `Source: ${source}`,
    '',
    'Added by Keeply after you approved your maintenance plan.',
  ].join('\n')

  return {
    taskId: task.id,
    summary: `${recommendation.taskName} · ${applianceName(appliance)}`,
    description,
    date,
    endDate: addInterval(date, { count: 1, unit: 'day' }),
    recurrence: task.schedulingMode === 'fixed_calendar' ? [toRRule(task.userInterval)] : [],
  }
}
