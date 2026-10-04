import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { GoogleCalendarError, googleCalendarWriter } from '@/calendar/google'
import { removeEvents, writeEvents, type CalendarWriter } from '@/calendar/writer'
import { loadApplianceTree } from '@/db/plan-queries'
import type { CalendarEventDraft } from '@/domain/calendar-event'
import { draftsForTasks } from '../../../lib/calendar-drafts'
import { bearerToken, parseDrafts, parseTaskIds, parseTaskRequest, TOKEN_COOKIE } from '../../../lib/calendar-session'
import type { ApplianceRecord } from '../../../lib/plan-state'
import { toApplianceRecord } from '../../../lib/supabase-plan-repository'

type Drafts = { drafts: CalendarEventDraft[] } | { error: string; status: number }

// With Supabase configured, the server loads the approved tasks itself under the caller's
// session (RLS), so a browser can only ever write its owner's approved tasks.
type Loaded = { record: ApplianceRecord } | { error: string; status: number }

async function recordFromSupabase(request: NextRequest, applianceId: string, url: string, anonKey: string): Promise<Loaded> {
  const userToken = bearerToken(request.headers.get('authorization'))
  if (!userToken) return { error: 'not_signed_in', status: 401 }
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const tree = await loadApplianceTree(db, applianceId)
  if (!tree) return { error: 'not_found', status: 404 }
  return { record: toApplianceRecord(tree) }
}

// Counts Google 401s so an expired token is forgotten.
function watchUnauthorised(writer: CalendarWriter) {
  const state = { unauthorised: false }
  const flag = (error: unknown) => {
    if (error instanceof GoogleCalendarError && error.status === 401) state.unauthorised = true
    throw error
  }
  const watched: CalendarWriter = {
    upsertEvent: (draft) => writer.upsertEvent(draft).catch(flag),
    deleteEvent: (taskId) => writer.deleteEvent(taskId).catch(flag),
  }
  return { watched, state }
}

function respond(body: unknown, unauthorised: boolean) {
  const response = NextResponse.json(body)
  // Expired or revoked Google token: forget it so the UI asks to reconnect.
  if (unauthorised) response.cookies.delete({ name: TOKEN_COOKIE, path: '/api/calendar' })
  return response
}

async function draftsFromSupabase(request: NextRequest, body: unknown, url: string, anonKey: string): Promise<Drafts> {
  const ask = parseTaskRequest(body)
  if (!ask) return { error: 'invalid_request', status: 400 }
  const loaded = await recordFromSupabase(request, ask.applianceId, url, anonKey)
  if ('error' in loaded) return loaded
  const { record } = loaded
  if (!record.approvedAt) return { error: 'not_approved', status: 409 }
  return { drafts: draftsForTasks(record, ask.taskIds.map((id) => ({ id }))) }
}

export async function POST(request: NextRequest) {
  const accessToken = request.cookies.get(TOKEN_COOKIE)?.value
  if (!accessToken) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = process.env
  let drafts: CalendarEventDraft[]
  if (url && anonKey) {
    const loaded = await draftsFromSupabase(request, body, url, anonKey).catch(() => ({ error: 'storage_unavailable', status: 502 }))
    if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    drafts = loaded.drafts
  } else {
    // Device storage: the plan only exists in the browser, so it sends validated drafts.
    const parsed = parseDrafts(body)
    if (!parsed) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    drafts = parsed
  }

  const { watched, state } = watchUnauthorised(googleCalendarWriter({ accessToken }))
  const results = await writeEvents(watched, drafts)
  return respond({ results }, state.unauthorised)
}

// Removes the events of paused tasks. Event ids derive from Keeply task ids, so only events
// Keeply created can ever be touched. With Supabase, each task must be the caller's and paused.
export async function DELETE(request: NextRequest) {
  const accessToken = request.cookies.get(TOKEN_COOKIE)?.value
  if (!accessToken) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = process.env
  let taskIds: string[]
  if (url && anonKey) {
    const ask = parseTaskRequest(body)
    if (!ask) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const loaded = await recordFromSupabase(request, ask.applianceId, url, anonKey).catch(
      (): Loaded => ({ error: 'storage_unavailable', status: 502 }),
    )
    if ('error' in loaded) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const paused = new Set(loaded.record.tasks.filter((t) => t.status === 'paused').map((t) => t.id))
    taskIds = ask.taskIds.filter((id) => paused.has(id))
  } else {
    const parsed = parseTaskIds(body)
    if (!parsed) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    taskIds = parsed
  }

  const { watched, state } = watchUnauthorised(googleCalendarWriter({ accessToken }))
  const results = await removeEvents(watched, taskIds)
  return respond({ results }, state.unauthorised)
}
