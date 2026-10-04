import { NextResponse, type NextRequest } from 'next/server'
import { CalendarScopeNotGrantedError, exchangeGoogleCode, googleOAuthConfig } from '@/calendar/google'
import { RETURN_COOKIE, safeReturnTo, STATE_COOKIE, TOKEN_COOKIE, withQuery } from '../../../lib/calendar-session'

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const returnTo = safeReturnTo(request.cookies.get(RETURN_COOKIE)?.value)
  const redirect = (status: string) => {
    const response = NextResponse.redirect(new URL(withQuery(returnTo, 'calendar', status), request.url))
    response.cookies.delete({ name: STATE_COOKIE, path: '/auth/google' })
    response.cookies.delete({ name: RETURN_COOKIE, path: '/auth/google' })
    return response
  }

  const config = googleOAuthConfig()
  if (!config) return redirect('unconfigured')

  const state = request.cookies.get(STATE_COOKIE)?.value
  const code = params.get('code')
  if (!state || state !== params.get('state') || !code) return redirect('denied')

  try {
    const { accessToken, expiresIn } = await exchangeGoogleCode(config, code)
    const response = redirect('connected')
    response.cookies.set(TOKEN_COOKIE, accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/calendar',
      maxAge: Math.max(60, expiresIn - 60),
    })
    return response
  } catch (error) {
    // Declining calendar access is a "no", not a failed sign-in.
    return redirect(error instanceof CalendarScopeNotGrantedError ? 'denied' : 'error')
  }
}
