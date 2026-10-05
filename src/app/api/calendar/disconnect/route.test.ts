import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The disconnect route now refuses cross-site POSTs before touching the token cookie. The Google
// revoke call is mocked so we only see whether the route short-circuited on origin.
const revokeCalls = vi.hoisted(() => [] as string[])

vi.mock('@/calendar/google', () => ({
  revokeGoogleToken: vi.fn(async (token: string) => {
    revokeCalls.push(token)
  }),
}))

import { POST } from './route'

const OWN = 'http://keeply.local'

beforeEach(() => {
  revokeCalls.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
})

function disconnectRequest(init: { origin?: string | null; accessToken?: string } = {}) {
  const headers: Record<string, string> = {}
  if (init.origin === undefined) headers.origin = OWN
  else if (init.origin !== null) headers.origin = init.origin
  if (init.accessToken !== undefined) headers.cookie = `keeply_gcal_token=${init.accessToken}`
  return new NextRequest(`${OWN}/api/calendar/disconnect`, { method: 'POST', headers })
}

describe('POST /api/calendar/disconnect hardening', () => {
  it.each([
    ['missing Origin', { origin: null }],
    ['cross-origin', { origin: 'https://evil.example' }],
  ])('returns 403 when the request is %s, without revoking the token or clearing the cookie', async (_label, opts) => {
    const response = await POST(disconnectRequest({ ...opts, accessToken: 't' }))
    expect(response.status).toBe(403)
    expect(revokeCalls).toEqual([])
  })

  it('clears the cookie and revokes the token for a same-origin request', async () => {
    const response = await POST(disconnectRequest({ accessToken: 't' }))
    expect(response.status).toBe(200)
    expect(revokeCalls).toEqual(['t'])
    expect(response.cookies.get('keeply_gcal_token')?.value ?? '').toBe('')
  })

  it('still answers 200 on a same-origin request without a token cookie', async () => {
    const response = await POST(disconnectRequest())
    expect(response.status).toBe(200)
    expect(revokeCalls).toEqual([])
  })
})