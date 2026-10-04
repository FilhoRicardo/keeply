import { NextResponse, type NextRequest } from 'next/server'
import { googleAuthorizationUrl, googleOAuthConfig } from '@/calendar/google'
import { RETURN_COOKIE, safeReturnTo, STATE_COOKIE, withQuery } from '../../../lib/calendar-session'

// Starts Google consent. Connecting reads and writes nothing; events are written only after Approval.
export function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'))
  const config = googleOAuthConfig()
  if (!config) return NextResponse.redirect(new URL(withQuery(returnTo, 'calendar', 'unconfigured'), request.url))

  const state = crypto.randomUUID()
  const response = NextResponse.redirect(googleAuthorizationUrl(config, state))
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/auth/google',
    maxAge: 600,
  }
  response.cookies.set(STATE_COOKIE, state, cookie)
  response.cookies.set(RETURN_COOKIE, returnTo, cookie)
  return response
}
