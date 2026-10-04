import { NextResponse, type NextRequest } from 'next/server'
import { GoogleCalendarError, googleCalendarWriter } from '@/calendar/google'
import { writeEvents } from '@/calendar/writer'
import { parseDrafts, TOKEN_COOKIE } from '../../../lib/calendar-session'

// Writes approved tasks to the owner's Google Calendar. The client calls this only from the
// Approval action. Once plans live in Supabase this should load approved tasks server-side
// instead of trusting drafts from the browser.
export async function POST(request: NextRequest) {
  const accessToken = request.cookies.get(TOKEN_COOKIE)?.value
  if (!accessToken) return NextResponse.json({ error: 'not_connected' }, { status: 401 })

  const drafts = parseDrafts(await request.json().catch(() => null))
  if (!drafts) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })

  let unauthorised = false
  const writer = googleCalendarWriter({ accessToken })
  const results = await writeEvents({
    async upsertEvent(draft) {
      try {
        return await writer.upsertEvent(draft)
      } catch (error) {
        if (error instanceof GoogleCalendarError && error.status === 401) unauthorised = true
        throw error
      }
    },
  }, drafts)

  const response = NextResponse.json({ results })
  // Expired or revoked token: forget it so the UI asks to reconnect.
  if (unauthorised) response.cookies.delete({ name: TOKEN_COOKIE, path: '/api/calendar' })
  return response
}
