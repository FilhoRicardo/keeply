import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The hardening under test (same-origin + JSON-only + production no-Supabase 503) is independent
// of the Google writer and Supabase. We mock both: a fake writer records whether it was called,
// and Supabase is opt-in per test (env vars). For the "charset accepted" check we go through the
// device-storage path with Supabase env cleared, which avoids depending on the Supabase mock.
const writerCalls = vi.hoisted(() => ({ upsert: [] as unknown[] }))

vi.mock('@/calendar/google', () => ({
  GoogleCalendarError: class extends Error {
    constructor(message: string, readonly status: number) {
      super(message)
      this.name = 'GoogleCalendarError'
    }
  },
  googleCalendarWriter: () => ({
    async upsertEvent(draft: unknown) {
      writerCalls.upsert.push(draft)
      return { eventId: 'e-1' }
    },
  }),
}))

vi.mock('@/db/queries', () => ({
  loadApplianceTree: vi.fn(async () => null),
}))

import { POST } from './route'

const OWN = 'http://keeply.local'

function request(body: unknown, init: { origin?: string | null; contentType?: string | null; accessToken?: string } = {}) {
  // Browsers always send Origin on fetch() (same-origin or cross-origin), so the production
  // shape is "Origin matches own origin". The hardening rejects a missing Origin outright, so a
  // happy-path test must set it to the request URL's origin. `origin: null` explicitly omits it
  // (used by negative tests).
  const headers: Record<string, string> = { 'content-type': init.contentType ?? 'application/json' }
  if (init.origin === undefined) headers.origin = OWN
  else if (init.origin !== null) headers.origin = init.origin
  if (init.accessToken !== undefined) headers.cookie = `keeply_gcal_token=${init.accessToken}`
  return new NextRequest(`${OWN}/api/calendar/events`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  writerCalls.upsert = []
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '')
  vi.stubEnv('VERCEL_ENV', '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('POST /api/calendar/events hardening', () => {
  it.each([
    ['missing Origin', { origin: null }],
    ['cross-origin', { origin: 'https://evil.example' }],
  ])('returns 403 when the request is %s, without calling the writer', async (_label, opts) => {
    const response = await POST(request({ drafts: [] }, { ...opts, accessToken: 't' }))
    expect(response.status).toBe(403)
    expect(writerCalls.upsert).toEqual([])
  })

  it('returns 415 when Content-Type is text/plain (which request.json() would otherwise parse)', async () => {
    const response = await POST(request('{"drafts":[]}', { contentType: 'text/plain', accessToken: 't' }))
    expect(response.status).toBe(415)
    expect(writerCalls.upsert).toEqual([])
  })

  it('returns 415 when Content-Type is missing', async () => {
    // No Origin header at all would be 403 first; the production shape is same-origin POSTs with
    // a body but no Content-Type, which is what this test models.
    const response = await POST(new NextRequest(`${OWN}/api/calendar/events`, { method: 'POST', headers: { origin: OWN }, body: '{}' }))
    expect(response.status).toBe(415)
  })

  it('accepts application/json with a charset and reaches the writer (device-storage path)', async () => {
    const response = await POST(
      request(
        { drafts: [{ taskId: 't', summary: 's', description: 'd', date: '2026-10-05', endDate: '2026-10-06', recurrence: ['RRULE:FREQ=MONTHLY'] }] },
        { contentType: 'application/json; charset=utf-8', accessToken: 't' },
      ),
    )
    expect(response.status).toBe(200)
    expect(writerCalls.upsert).toHaveLength(1)
  })

  it('keeps the device-storage drafts path working outside production when Supabase env is missing', async () => {
    const response = await POST(
      request(
        { drafts: [{ taskId: 't', summary: 's', description: 'd', date: '2026-10-05', endDate: '2026-10-06', recurrence: ['RRULE:FREQ=MONTHLY'] }] },
        { accessToken: 't' },
      ),
    )
    expect(response.status).toBe(200)
    expect(writerCalls.upsert).toHaveLength(1)
  })

  it('returns 503 storage_unavailable in production when Supabase env is missing, even with drafts, and never calls the writer', async () => {
    vi.stubEnv('VERCEL_ENV', 'production')
    const response = await POST(
      request(
        { drafts: [{ taskId: 't', summary: 's', description: 'd', date: '2026-10-05', endDate: '2026-10-06', recurrence: ['RRULE:FREQ=MONTHLY'] }] },
        { accessToken: 't' },
      ),
    )
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'storage_unavailable' })
    expect(writerCalls.upsert).toEqual([])
  })
})