import { NextResponse, type NextRequest } from 'next/server'
import { bearerToken, enforceSameOrigin } from '../../../lib/calendar-session'
import { callerDb } from '../../../lib/scan-gate'
import type { TaskRow } from '@/db/rows'

// KEE-44: read-only helper for the G10 live gate (docs/live-gates.md). Returns the
// calendar_event_id of the accepted task on an approved plan, scoped to the caller's session via
// Supabase RLS. Same shape and auth pattern as /api/plan: same-origin only, Bearer token forwarded
// by the harness from the page's Supabase client, no service-role key (so the visitor cannot read
// another user's appliance).
//
// We deliberately read maintenance_tasks via the caller's session instead of going through the
// service role: a verification endpoint that crosses RLS could leak data in CI logs and breaks the
// rule that AI never authorises writes (this is a read but uses the same trust boundary). The
// harness's `keeply.plan.v2` localStorage read is gone for the same reason — on a Vercel Preview
// the Supabase adapter is in use, so the localStorage key is never written.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type G10CalendarEventResponse =
  | { applianceId: string; calendarEventId: string | null }
  | { applianceId: string; calendarEventId: null; reason: 'not_approved' | 'no_accepted' }

export async function GET(request: NextRequest): Promise<NextResponse> {
  const originGuard = enforceSameOrigin(request)
  if (originGuard) return originGuard
  const applianceId = request.nextUrl.searchParams.get('applianceId')
  if (!applianceId || !UUID.test(applianceId)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const token = bearerToken(request.headers.get('authorization'))
  if (!token) {
    // No session → no data. The harness should pass the same Bearer token it already uses for
    // /api/plan; refusing here is the same trust boundary as the rest of the routes.
    return NextResponse.json({ error: 'not_signed_in' }, { status: 401 })
  }
  const db = callerDb(request)
  if (!db) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const { data, error } = await db
    .from('appliances')
    .select('id, approved_at, maintenance_tasks(id, position, status, calendar_event_id)')
    .eq('id', applianceId)
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 502 })
  }
  if (!data) {
    // Either the appliance does not exist or belongs to someone else (RLS). We return the same
    // answer in both cases so the endpoint does not leak existence.
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  if (!data.approved_at) {
    const body: G10CalendarEventResponse = { applianceId, calendarEventId: null, reason: 'not_approved' }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  }
  const tasks = (data.maintenance_tasks ?? []) as TaskRow[]
  const accepted = tasks
    .filter((t) => t.status === 'accepted')
    .sort((a, b) => a.position - b.position)
  if (accepted.length === 0) {
    const body: G10CalendarEventResponse = { applianceId, calendarEventId: null, reason: 'no_accepted' }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
  }
  // The harness wants a single value. If more than one task was accepted (KEE-44 case 1: only one
  // accepted by design, but the data model allows several), join them so the runner sees every
  // calendar event Keeply wrote for the appliance.
  const ids = accepted.map((t) => t.calendar_event_id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  const body: G10CalendarEventResponse =
    ids.length === 0
      ? { applianceId, calendarEventId: null, reason: 'no_accepted' }
      : { applianceId, calendarEventId: ids.join(',') }
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}
