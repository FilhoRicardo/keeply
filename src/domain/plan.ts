import { isLocalDate, type LocalDate } from './dates'
import type { Interval } from './format-interval'
import type { Recommendation, SchedulingMode, Task } from './model'

export type Customisation = {
  interval: Interval
  startDate: LocalDate
  schedulingMode: SchedulingMode
}

export type Decision =
  | { kind: 'include' }
  | ({ kind: 'customise' } & Customisation)
  | { kind: 'skip' }

// The owner's choices, keyed by Recommendation id. Missing means undecided.
export type Decisions = Readonly<Record<string, Decision>>

// Included-as-recommended tasks recur on a fixed calendar; Customise can switch to completion-based.
export const DEFAULT_SCHEDULING_MODE: SchedulingMode = 'fixed_calendar'

export type ApprovalBlocker = 'undecided' | 'nothing_included' | 'invalid_customisation'

export function validateCustomisation({ interval, startDate }: Customisation): string | null {
  if (!Number.isInteger(interval.count) || interval.count < 1 || interval.count > 999) {
    return 'Frequency must be a whole number of at least 1.'
  }
  if (!isLocalDate(startDate)) return 'Choose a valid start date.'
  return null
}

export function approvalBlockers(recommendations: readonly Recommendation[], decisions: Decisions): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = []
  const chosen = recommendations.map((r) => decisions[r.id])
  if (chosen.some((d) => d === undefined)) blockers.push('undecided')
  if (!chosen.some((d) => d && d.kind !== 'skip')) blockers.push('nothing_included')
  if (chosen.some((d) => d?.kind === 'customise' && validateCustomisation(d) !== null)) {
    blockers.push('invalid_customisation')
  }
  return blockers
}

export function canApprove(recommendations: readonly Recommendation[], decisions: Decisions): boolean {
  return approvalBlockers(recommendations, decisions).length === 0
}

export type ApprovalInput = {
  recommendations: readonly Recommendation[]
  decisions: Decisions
  // Start date for tasks included as recommended.
  defaultStartDate: LocalDate
  newId: () => string
}

// Turn decisions into Tasks. Only call this from the explicit Approval action.
// Recommendations are read, never changed: the user's interval lives on the Task.
export function approvePlan({ recommendations, decisions, defaultStartDate, newId }: ApprovalInput): Task[] {
  const blockers = approvalBlockers(recommendations, decisions)
  if (blockers.length > 0) throw new Error(`Plan cannot be approved: ${blockers.join(', ')}`)
  if (!isLocalDate(defaultStartDate)) throw new Error(`Not a LocalDate: ${defaultStartDate}`)

  return recommendations.map((rec) => {
    const decision = decisions[rec.id]
    const base = { id: newId(), applianceId: rec.applianceId, recommendationId: rec.id, calendarEventId: null }
    switch (decision.kind) {
      case 'include':
        return {
          ...base,
          status: 'approved',
          userInterval: { ...rec.recommendedInterval },
          startDate: defaultStartDate,
          schedulingMode: DEFAULT_SCHEDULING_MODE,
        }
      case 'customise':
        return {
          ...base,
          status: 'approved',
          userInterval: { ...decision.interval },
          startDate: decision.startDate,
          schedulingMode: decision.schedulingMode,
        }
      case 'skip':
        return {
          ...base,
          status: 'skipped',
          userInterval: { ...rec.recommendedInterval },
          startDate: defaultStartDate,
          schedulingMode: DEFAULT_SCHEDULING_MODE,
        }
    }
  })
}

// The only Tasks that may ever reach a calendar.
export function calendarBound(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.status === 'approved')
}

// Changes the owner's schedule on an approved Task. The Recommendation is untouched.
export function rescheduleTask(task: Task, customisation: Customisation): Task {
  if (task.status !== 'approved') throw new Error('Only approved tasks can be rescheduled.')
  const problem = validateCustomisation(customisation)
  if (problem) throw new Error(problem)
  return {
    ...task,
    userInterval: { ...customisation.interval },
    startDate: customisation.startDate,
    schedulingMode: customisation.schedulingMode,
  }
}
