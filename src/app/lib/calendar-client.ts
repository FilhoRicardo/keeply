import type { WriteResult } from '@/calendar/writer'
import { calendarBound } from '@/domain/plan'
import type { CalendarStatus } from '../api/calendar/status/route'
import type { Task } from '@/domain/model'
import { draftsForTasks } from './calendar-drafts'
import type { ApplianceRecord } from './plan-state'

export type { CalendarStatus }

export async function fetchCalendarStatus(): Promise<CalendarStatus> {
  try {
    const response = await fetch('/api/calendar/status', { cache: 'no-store' })
    if (!response.ok) return { configured: false, connected: false }
    return (await response.json()) as CalendarStatus
  } catch {
    return { configured: false, connected: false }
  }
}

export function connectUrl(returnTo: string): string {
  return `/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`
}

// Approved tasks not yet on the calendar. Skipped tasks are never included.
export function pendingCalendarTasks(record: ApplianceRecord) {
  return calendarBound(record.tasks).filter((t) => t.calendarEventId === null)
}

export type CalendarWriteOutcome = { kind: 'written'; results: WriteResult[] } | { kind: 'not_connected' } | { kind: 'failed' }

// Writes approved tasks not yet in the calendar.
export function writeApprovedTasks(record: ApplianceRecord, accessToken: string | null = null): Promise<CalendarWriteOutcome> {
  return writeTasks(record, pendingCalendarTasks(record), accessToken)
}

// Completion-based tasks are a single event on the next due date; after a completion, move it.
export function needsReschedule(task: Task): boolean {
  return task.status === 'approved' && task.schedulingMode === 'completion_based' && task.calendarEventId !== null
}

// Creates or updates the calendar event for each given task (upsert per task).
// With a Supabase session the server loads the approved tasks itself and only task ids are sent;
// with device storage the browser sends the drafts.
export async function writeTasks(
  record: ApplianceRecord,
  tasks: readonly Task[],
  accessToken: string | null = null,
): Promise<CalendarWriteOutcome> {
  const drafts = draftsForTasks(record, tasks)
  if (drafts.length === 0) return { kind: 'written', results: [] }
  const body = accessToken
    ? { applianceId: record.appliance.id, taskIds: drafts.map((d) => d.taskId) }
    : { drafts }
  try {
    const response = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: JSON.stringify(body),
    })
    if (response.status === 401) return { kind: 'not_connected' }
    if (!response.ok) return { kind: 'failed' }
    const { results } = (await response.json()) as { results: WriteResult[] }
    return { kind: 'written', results }
  } catch {
    return { kind: 'failed' }
  }
}

export async function disconnectCalendar(): Promise<boolean> {
  try {
    return (await fetch('/api/calendar/disconnect', { method: 'POST' })).ok
  } catch {
    return false
  }
}

// Paused tasks whose event is still in the calendar (removal skipped or failed).
export function pendingCalendarRemovals(record: ApplianceRecord) {
  return record.tasks.filter((t) => t.status === 'paused' && t.calendarEventId !== null)
}

export type CalendarRemoveOutcome = { kind: 'removed'; taskIds: string[] } | { kind: 'not_connected' } | { kind: 'failed' }

// Takes paused tasks' events off the calendar. Only Keeply's own events can be addressed.
export async function removeTaskEvents(
  record: ApplianceRecord,
  taskIds: readonly string[],
  accessToken: string | null = null,
): Promise<CalendarRemoveOutcome> {
  if (taskIds.length === 0) return { kind: 'removed', taskIds: [] }
  const body = accessToken ? { applianceId: record.appliance.id, taskIds } : { taskIds }
  try {
    const response = await fetch('/api/calendar/events', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
    })
    if (response.status === 401) return { kind: 'not_connected' }
    if (!response.ok) return { kind: 'failed' }
    const { results } = (await response.json()) as { results: { taskId: string; ok: boolean }[] }
    return { kind: 'removed', taskIds: results.filter((r) => r.ok).map((r) => r.taskId) }
  } catch {
    return { kind: 'failed' }
  }
}
