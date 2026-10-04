import { NextResponse, type NextRequest } from 'next/server'
import { revokeGoogleToken } from '@/calendar/google'
import { TOKEN_COOKIE } from '../../../lib/calendar-session'

// Forgets the Google token and asks Google to revoke it. Existing calendar events stay.
export async function POST(request: NextRequest) {
  const token = request.cookies.get(TOKEN_COOKIE)?.value
  if (token) await revokeGoogleToken(token).catch(() => {})
  const response = NextResponse.json({ connected: false })
  response.cookies.delete({ name: TOKEN_COOKIE, path: '/api/calendar' })
  return response
}
