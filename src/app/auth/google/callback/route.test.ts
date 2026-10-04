import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GOOGLE_CALENDAR_SCOPE } from '@/calendar/google'
import { GET } from './route'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

function callback(scope: string) {
  vi.stubEnv('GOOGLE_CLIENT_ID', 'cid')
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
  vi.stubEnv('GOOGLE_REDIRECT_URI', 'http://keeply.local/auth/google/callback')
  vi.stubGlobal('fetch', async () => Response.json({ access_token: 'at', expires_in: 3600, scope }))
  return GET(
    new NextRequest('http://keeply.local/auth/google/callback?code=c&state=s', {
      headers: { cookie: 'keeply_gcal_state=s; keeply_gcal_return=/appliances/a/plan' },
    }),
  )
}

describe('Google OAuth callback', () => {
  it('connects when calendar access is granted', async () => {
    const response = await callback(GOOGLE_CALENDAR_SCOPE)
    expect(response.headers.get('location')).toBe('http://keeply.local/appliances/a/plan?calendar=connected')
    expect(response.cookies.get('keeply_gcal_token')?.value).toBe('at')
  })

  it('reports "denied" when the owner unticks calendar access', async () => {
    const response = await callback('openid email')
    expect(response.headers.get('location')).toBe('http://keeply.local/appliances/a/plan?calendar=denied')
    expect(response.cookies.get('keeply_gcal_token')?.value ?? '').toBe('')
  })

  it('reports "denied" when the state does not match', async () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', 'cid')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
    vi.stubEnv('GOOGLE_REDIRECT_URI', 'http://keeply.local/auth/google/callback')
    const response = await GET(
      new NextRequest('http://keeply.local/auth/google/callback?code=c&state=evil', { headers: { cookie: 'keeply_gcal_state=s' } }),
    )
    expect(response.headers.get('location')).toBe('http://keeply.local/?calendar=denied')
  })
})
