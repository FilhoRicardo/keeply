import { NextResponse, type NextRequest } from 'next/server'
import type { CalendarEventDraft } from '@/domain/calendar-event'
import { isLocalDate } from '@/domain/dates'

export const TOKEN_COOKIE = 'keeply_gcal_token'
export const STATE_COOKIE = 'keeply_gcal_state'
export const RETURN_COOKIE = 'keeply_gcal_return'
export const MAX_EVENTS_PER_REQUEST = 20

// Only same-origin relative paths; anything else falls back to home.
export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

export function withQuery(path: string, key: string, value: string): string {
  const url = new URL(path, 'http://keeply.local')
  url.searchParams.set(key, value)
  return `${url.pathname}${url.search}`
}

// Only the rules toRRule produces: a frequency, an interval, and the month-end clamp.
const RRULE =
  /^RRULE:FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;INTERVAL=\d{1,3})?(;BYMONTH=2)?(;BYMONTHDAY=28(,29(,30(,31)?)?)?;BYSETPOS=-1)?$/

function isDraft(value: unknown): value is CalendarEventDraft {
  if (!value || typeof value !== 'object') return false
  const d = value as Record<string, unknown>
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max
  return (
    text(d.taskId, 100) &&
    text(d.summary, 300) &&
    typeof d.description === 'string' &&
    d.description.length <= 4000 &&
    typeof d.date === 'string' &&
    isLocalDate(d.date) &&
    typeof d.endDate === 'string' &&
    isLocalDate(d.endDate) &&
    d.endDate > d.date &&
    Array.isArray(d.recurrence) &&
    d.recurrence.length <= 1 &&
    d.recurrence.every((r) => typeof r === 'string' && RRULE.test(r))
  )
}

export function parseDrafts(body: unknown): CalendarEventDraft[] | null {
  const drafts = (body as { drafts?: unknown } | null)?.drafts
  if (!Array.isArray(drafts) || drafts.length === 0 || drafts.length > MAX_EVENTS_PER_REQUEST) return null
  if (!drafts.every(isDraft)) return null
  return drafts.map(({ taskId, summary, description, date, endDate, recurrence }) => ({
    taskId,
    summary,
    description,
    date,
    endDate,
    recurrence: [...recurrence],
  }))
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Supabase mode: the browser names tasks; the server loads them under the user's session.
export function parseTaskRequest(body: unknown): { applianceId: string; taskIds: string[] } | null {
  const { applianceId, taskIds } = (body ?? {}) as { applianceId?: unknown; taskIds?: unknown }
  if (typeof applianceId !== 'string' || !UUID.test(applianceId)) return null
  if (!Array.isArray(taskIds) || taskIds.length === 0 || taskIds.length > MAX_EVENTS_PER_REQUEST) return null
  if (!taskIds.every((id) => typeof id === 'string' && UUID.test(id))) return null
  return { applianceId, taskIds: [...new Set(taskIds as string[])] }
}

export function bearerToken(header: string | null): string | null {
  const match = /^Bearer (\S+)$/.exec(header ?? '')
  return match ? match[1] : null
}

// Stops a credentialed cross-site "simple" POST. Browsers send Origin on every fetch and on most
// navigation POSTs, so a missing or mismatched Origin is not a same-origin request. SameSite=Lax
// alone does not cover every shape of cross-site write (e.g. form posts without a cookie).
export function enforceSameOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin')
  if (origin && origin === request.nextUrl.origin) return null
  return NextResponse.json({ error: 'forbidden' }, { status: 403 })
}

// request.json() happily parses text/plain, so an attacker can still send a body that looks like
// JSON. Browsers set Content-Type to application/json for fetch(), so requiring it is safe.
export function enforceJsonContentType(request: NextRequest): NextResponse | null {
  const raw = request.headers.get('content-type')?.trim().toLowerCase() ?? ''
  // Charset (e.g. "application/json; charset=utf-8") is allowed; anything else is not JSON.
  const mediaType = raw.split(';', 1)[0]?.trim() ?? ''
  if (mediaType === 'application/json') return null
  return NextResponse.json({ error: 'unsupported_media_type' }, { status: 415 })
}
