import { createClient } from '@supabase/supabase-js'
import { NextResponse, type NextRequest } from 'next/server'
import { GoogleCalendarError, googleCalendarWriter } from '@/calendar/google'
import { writeEvents, type CalendarWriter } from '@/calendar/writer'
import { loadApplianceTree } from '@/db/queries'
import { toApplianceRecord } from '@/db/rows'
import { draftsForTasks, type CalendarEventDraft } from '@/domain/calendar-event'
import { bearerToken, parseDrafts, parseTaskRequest, TOKEN_COOKIE } from '../../../lib/calendar-session'

type Drafts = { drafts: CalendarEventDraft[] } | { error: string; status: number }

// With Supabase configured, the server loads the approved plan itself under the caller's session
// (RLS), so a browser can only ever write its owner's accepted, approved tasks.
async function draftsFromSupabase(request: NextRequest, body: unknown, url: string, anonKey: string): Promise<Drafts> {
  const ask = parseTaskRequest(body)
  if (!ask) return { error: 'invalid_request', status: 400 }
  const userToken = bearerToken(request.headers.get('authorization'))
  if (!userToken) return { error: 'not_signed_in', status: 401 }
  const db = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${userToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const tree = await loadApplianceTree(db, ask.applianceId)
  if (!tree) return { error: 'not_found', status: 404 }
  const record = toApplianceRecord(tree)
  if (!record.approvedAt) return { error: 'not_approved', status: 409 }
  return { drafts: draftsForTasks(record, ask.taskIds) }
}

// Notes Google 401s so an expired token is forgotten.
function watchUnauthorised(writer: CalendarWriter) {
  const state = { unauthorised: false }
  const watched: CalendarWriter = {
    upsertEvent: (draft) =>
      writer.upsertEvent(draft).catch((error: unknown) => {
        if (error instanceof GoogleCalendarError && error.status === 401) state.unauthorised = true
        throw error
      }),
  }
  return { watched, state }
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
  const response = NextResponse.json({ results })
  // Expired or revoked Google token: forget it so the UI asks to reconnect.
  if (state.unauthorised) response.cookies.delete({ name: TOKEN_COOKIE, path: '/api/calendar' })
  return response
}
