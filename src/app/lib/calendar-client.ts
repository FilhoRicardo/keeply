import type { WriteResult } from '@/calendar/writer'
import { toCalendarEvent } from '@/domain/calendar-event'
import { calendarBound } from '@/domain/plan'
import type { CalendarStatus } from '../api/calendar/status/route'
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

export async function writeApprovedTasks(record: ApplianceRecord): Promise<CalendarWriteOutcome> {
  if (!record.approvedAt) throw new Error('Approve the plan before writing to a calendar.')
  const drafts = pendingCalendarTasks(record).map((task) => {
    const rec = record.recommendations.find((r) => r.id === task.recommendationId)!
    return toCalendarEvent(task, rec, record.appliance, record.completions)
  })
  if (drafts.length === 0) return { kind: 'written', results: [] }
  try {
    const response = await fetch('/api/calendar/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ drafts }),
    })
    if (response.status === 401) return { kind: 'not_connected' }
    if (!response.ok) return { kind: 'failed' }
    const { results } = (await response.json()) as { results: WriteResult[] }
    return { kind: 'written', results }
  } catch {
    return { kind: 'failed' }
  }
}
