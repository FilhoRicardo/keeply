import { isLocalDate, type LocalDate } from './dates'
import type { ApplianceRecord, MaintenanceTask } from './model'

// The owner's answer for one proposed task. null takes the answer back.
export type Decision = 'accepted' | 'rejected'

export type ApprovalBlocker = 'undecided' | 'nothing_accepted'

export function approvalBlockers(tasks: readonly Pick<MaintenanceTask, 'status'>[]): ApprovalBlocker[] {
  const blockers: ApprovalBlocker[] = []
  if (tasks.some((t) => t.status === 'proposed')) blockers.push('undecided')
  if (!tasks.some((t) => t.status === 'accepted')) blockers.push('nothing_accepted')
  return blockers
}

export function canApprove(tasks: readonly Pick<MaintenanceTask, 'status'>[]): boolean {
  return approvalBlockers(tasks).length === 0
}

// Accept or reject one task before Approval. The proposal itself never changes.
export function decideTask(record: ApplianceRecord, taskId: string, decision: Decision | null): ApplianceRecord {
  if (record.approvedAt) throw new Error('This plan is already approved.')
  if (!record.tasks.some((t) => t.id === taskId)) throw new Error(`Unknown task ${taskId}`)
  return {
    ...record,
    tasks: record.tasks.map((t) => (t.id === taskId ? { ...t, status: decision ?? 'proposed' } : t)),
  }
}

// The Approval action: the only way anything becomes eligible for a calendar.
export function approvePlan(record: ApplianceRecord, startDate: LocalDate, now: string): ApplianceRecord {
  if (record.approvedAt) throw new Error('This plan is already approved.')
  const blockers = approvalBlockers(record.tasks)
  if (blockers.length > 0) throw new Error(`Plan cannot be approved: ${blockers.join(', ')}`)
  if (!isLocalDate(startDate)) throw new Error(`Not a LocalDate: ${startDate}`)
  return { ...record, approvedAt: now, startDate }
}

// The only tasks that may ever reach a calendar: accepted, in an approved plan.
export function calendarBound(record: ApplianceRecord): MaintenanceTask[] {
  return record.approvedAt ? record.tasks.filter((t) => t.status === 'accepted') : []
}

// Accepted tasks not yet in the calendar (first write, or a retry after a failure).
export function pendingCalendarTasks(record: ApplianceRecord): MaintenanceTask[] {
  return calendarBound(record).filter((t) => t.calendarEventId === null)
}
