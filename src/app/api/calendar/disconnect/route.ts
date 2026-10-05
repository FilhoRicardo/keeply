import { NextResponse, type NextRequest } from 'next/server'
import { revokeGoogleToken } from '@/calendar/google'
import { enforceSameOrigin, TOKEN_COOKIE } from '../../../lib/calendar-session'

// Forgets the Google token and asks Google to revoke it. Existing calendar events stay.
export async function POST(request: NextRequest) {
  // Same-origin first: a cross-site POST should not be able to clear the owner's token cookie.
  const originGuard = enforceSameOrigin(request)
  if (originGuard) return originGuard

  const token = request.cookies.get(TOKEN_COOKIE)?.value
  if (token) await revokeGoogleToken(token).catch(() => {})
  const response = NextResponse.json({ connected: false })
  response.cookies.delete({ name: TOKEN_COOKIE, path: '/api/calendar' })
  return response
}
