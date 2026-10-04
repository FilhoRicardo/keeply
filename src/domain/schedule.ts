import { addInterval, compareDates, isLocalDate, type LocalDate } from './dates'
import type { Interval } from './format-interval'
import type { Completion, Task } from './model'

function latestCompletion(taskId: string, completions: readonly Completion[]): LocalDate | null {
  return completions
    .filter((c) => c.taskId === taskId)
    .map((c) => c.completedOn)
    .reduce<LocalDate | null>((latest, d) => (latest === null || compareDates(d, latest) > 0 ? d : latest), null)
}

// First occurrence strictly after `after` on the grid start, start + interval, start + 2·interval, …
function nextOnGrid(start: LocalDate, interval: Interval, after: LocalDate): LocalDate {
  let n = 0
  let date = start
  while (compareDates(date, after) <= 0) {
    n += 1
    date = addInterval(start, interval, n)
  }
  return date
}

// When the Task is next due.
// fixed_calendar: the next grid date after the latest completion (or the start date).
// completion_based: latest completion + interval (or the start date if never completed).
export function nextDue(task: Pick<Task, 'id' | 'startDate' | 'userInterval' | 'schedulingMode'>, completions: readonly Completion[]): LocalDate {
  const last = latestCompletion(task.id, completions)
  if (last === null) return task.startDate
  if (task.schedulingMode === 'completion_based') return addInterval(last, task.userInterval)
  return nextOnGrid(task.startDate, task.userInterval, last)
}

export function isOverdue(due: LocalDate, today: LocalDate): boolean {
  return compareDates(due, today) < 0
}

export const MAX_COMPLETION_NOTE = 280

// A completion is a date the owner actually did the task: valid, not in the future.
export function validateCompletion(completedOn: string, today: LocalDate, notes: string | null): string | null {
  if (!isLocalDate(completedOn)) return 'Choose the date you did it.'
  if (compareDates(completedOn, today) > 0) return 'The date cannot be in the future.'
  if (notes && notes.length > MAX_COMPLETION_NOTE) return `Keep the note under ${MAX_COMPLETION_NOTE} characters.`
  return null
}
