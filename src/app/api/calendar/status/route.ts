import { NextResponse, type NextRequest } from 'next/server'
import { googleOAuthConfig } from '@/calendar/google'
import { TOKEN_COOKIE } from '../../../lib/calendar-session'

export type CalendarStatus = { configured: boolean; connected: boolean }

export function GET(request: NextRequest) {
  const status: CalendarStatus = {
    configured: googleOAuthConfig() !== null,
    connected: Boolean(request.cookies.get(TOKEN_COOKIE)?.value),
  }
  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
}
