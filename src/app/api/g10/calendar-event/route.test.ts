import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// KEE-44 G10 helper: same-origin read of the accepted task's calendar_event_id for a given
// appliance. RLS scopes the read to the caller; the test pins the trust boundary (same-origin,
// signed-in, valid UUID) and the response shape.

const callerDbMock = vi.fn()
vi.mock('../../../lib/scan-gate', () => ({ callerDb: (...args: unknown[]) => callerDbMock(...args) }))

const fromMock = vi.fn()
const selectMock = vi.fn()
const eqMock = vi.fn()
const maybeSingleMock = vi.fn()

import { GET } from './route'

function get(
  search: string,
  headers: Record<string, string> = { origin: 'http://keeply.local' },
): Promise<Response> {
  return GET(new NextRequest(`http://keeply.local/api/g10/calendar-event${search}`, { headers }))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  callerDbMock.mockReset()
  fromMock.mockReset()
  selectMock.mockReset()
  eqMock.mockReset()
  maybeSingleMock.mockReset()
})

function chainResult(result: { data: unknown; error: unknown }) {
  eqMock.mockReturnValue({ maybeSingle: maybeSingleMock })
  selectMock.mockReturnValue({ eq: eqMock })
  fromMock.mockReturnValue({ select: selectMock })
  maybeSingleMock.mockResolvedValue(result)
  callerDbMock.mockReturnValue({ from: fromMock })
}

describe('GET /api/g10/calendar-event', () => {
  it('rejects a cross-origin request with 403', async () => {
    const response = await GET(
      new NextRequest('http://keeply.local/api/g10/calendar-event?applianceId=00000000-0000-0000-0000-000000000001', {
        headers: { origin: 'https://evil.example' },
      }),
    )
    expect(response.status).toBe(403)
    expect(callerDbMock).not.toHaveBeenCalled()
  })

  it('returns 400 when applianceId is missing or not a UUID', async () => {
    const a = await get('?applianceId=', { origin: 'http://keeply.local' })
    expect(a.status).toBe(400)
    const b = await get('', { origin: 'http://keeply.local' })
    expect(b.status).toBe(400)
    const c = await get('?applianceId=not-a-uuid', { origin: 'http://keeply.local' })
    expect(c.status).toBe(400)
    expect(callerDbMock).not.toHaveBeenCalled()
  })

  it('returns 401 when the caller is not signed in (no Bearer token)', async () => {
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', { origin: 'http://keeply.local' })
    expect(response.status).toBe(401)
    expect(callerDbMock).not.toHaveBeenCalled()
  })

  it('returns 503 when Supabase is not configured', async () => {
    callerDbMock.mockReturnValueOnce(null)
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', {
      origin: 'http://keeply.local',
      authorization: 'Bearer user-session-token',
    })
    expect(response.status).toBe(503)
  })

  it('returns 404 when RLS hides the appliance (does not leak existence)', async () => {
    chainResult({ data: null, error: null })
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', {
      origin: 'http://keeply.local',
      authorization: 'Bearer user-session-token',
    })
    expect(response.status).toBe(404)
    expect(callerDbMock).toHaveBeenCalledTimes(1)
  })

  it('returns 502 when Supabase reports a storage error', async () => {
    chainResult({ data: null, error: { message: 'connection refused' } })
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', {
      origin: 'http://keeply.local',
      authorization: 'Bearer user-session-token',
    })
    expect(response.status).toBe(502)
  })

  it('returns reason=not_approved when the plan has not been approved yet', async () => {
    chainResult({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        approved_at: null,
        maintenance_tasks: [{ id: 't1', position: 1, status: 'accepted', calendar_event_id: null }],
      },
      error: null,
    })
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', {
      origin: 'http://keeply.local',
      authorization: 'Bearer user-session-token',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      applianceId: '00000000-0000-0000-0000-000000000001',
      calendarEventId: null,
      reason: 'not_approved',
    })
  })

  it('returns the accepted task calendar_event_id after Approval', async () => {
    chainResult({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        approved_at: '2026-10-05T12:34:56Z',
        maintenance_tasks: [
          { id: 't1', position: 1, status: 'rejected', calendar_event_id: null },
          { id: 't2', position: 2, status: 'accepted', calendar_event_id: 'kp1234abcd' },
        ],
      },
      error: null,
    })
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', {
      origin: 'http://keeply.local',
      authorization: 'Bearer user-session-token',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      applianceId: '00000000-0000-0000-0000-000000000001',
      calendarEventId: 'kp1234abcd',
    })
  })

  it('joins multiple accepted task calendar_event_ids with a comma', async () => {
    chainResult({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        approved_at: '2026-10-05T12:34:56Z',
        maintenance_tasks: [
          { id: 't1', position: 1, status: 'accepted', calendar_event_id: 'kp-aaa' },
          { id: 't2', position: 2, status: 'rejected', calendar_event_id: null },
          { id: 't3', position: 3, status: 'accepted', calendar_event_id: 'kp-bbb' },
        ],
      },
      error: null,
    })
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', {
      origin: 'http://keeply.local',
      authorization: 'Bearer user-session-token',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      applianceId: '00000000-0000-0000-0000-000000000001',
      calendarEventId: 'kp-aaa,kp-bbb',
    })
  })

  it('returns reason=no_accepted when the plan is approved but no task was accepted', async () => {
    chainResult({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        approved_at: '2026-10-05T12:34:56Z',
        maintenance_tasks: [
          { id: 't1', position: 1, status: 'rejected', calendar_event_id: null },
        ],
      },
      error: null,
    })
    const response = await get('?applianceId=00000000-0000-0000-0000-000000000001', {
      origin: 'http://keeply.local',
      authorization: 'Bearer user-session-token',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      applianceId: '00000000-0000-0000-0000-000000000001',
      calendarEventId: null,
      reason: 'no_accepted',
    })
  })
})
