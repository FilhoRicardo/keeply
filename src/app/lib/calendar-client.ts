import type { WriteResult } from '@/calendar/writer'
import { draftsForTasks } from '@/domain/calendar-event'
import type { ApplianceRecord } from '@/domain/model'
import { pendingCalendarTasks } from '@/domain/plan'
import type { CalendarStatus } from '../api/calendar/status/route'
import { MAX_EVENTS_PER_REQUEST } from './calendar-session'

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

export type CalendarWriteOutcome = { kind: 'written'; results: WriteResult[] } | { kind: 'not_connected' } | { kind: 'failed' }

// Writes the approved plan's accepted tasks that are not yet in the calendar. Writes are upserts
// keyed by task id, so a retry never duplicates. With a Supabase session the server loads the
// approved tasks itself and only ids are sent; with device storage the browser sends the drafts.
export async function writeApprovedTasks(record: ApplianceRecord, accessToken: string | null = null): Promise<CalendarWriteOutcome> {
  const drafts = draftsForTasks(
    record,
    pendingCalendarTasks(record).map((t) => t.id),
  )
  const results: WriteResult[] = []
  for (let i = 0; i < drafts.length; i += MAX_EVENTS_PER_REQUEST) {
    const batch = drafts.slice(i, i + MAX_EVENTS_PER_REQUEST)
    const body = accessToken ? { applianceId: record.appliance.id, taskIds: batch.map((d) => d.taskId) } : { drafts: batch }
    let outcome: CalendarWriteOutcome
    try {
      const response = await fetch('/api/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify(body),
      })
      if (response.status === 401) outcome = { kind: 'not_connected' }
      else if (!response.ok) outcome = { kind: 'failed' }
      else outcome = { kind: 'written', results: ((await response.json()) as { results: WriteResult[] }).results }
    } catch {
      outcome = { kind: 'failed' }
    }
    if (outcome.kind !== 'written') return results.length > 0 ? { kind: 'written', results } : outcome
    results.push(...outcome.results)
  }
  return { kind: 'written', results }
}

export async function disconnectCalendar(): Promise<boolean> {
  try {
    return (await fetch('/api/calendar/disconnect', { method: 'POST' })).ok
  } catch {
    return false
  }
}
