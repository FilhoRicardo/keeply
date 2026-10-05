import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { bearerToken, enforceJsonContentType, enforceSameOrigin, parseDrafts, parseTaskRequest, safeReturnTo, withQuery } from './calendar-session'

const draft = {
  taskId: 't1',
  summary: 'Clean the filter',
  description: 'Rinse it',
  date: '2026-10-05',
  endDate: '2026-10-06',
  recurrence: ['RRULE:FREQ=MONTHLY;INTERVAL=3'],
}

describe('safeReturnTo', () => {
  it.each([
    ['/appliances/1/plan', '/appliances/1/plan'],
    ['https://evil.example', '/'],
    ['//evil.example', '/'],
    ['/\\evil.example', '/'],
    [null, '/'],
  ])('%s → %s', (input, expected) => {
    expect(safeReturnTo(input)).toBe(expected)
  })
})

describe('withQuery', () => {
  it('adds a parameter to a path', () => {
    expect(withQuery('/appliances/1/plan', 'calendar', 'connected')).toBe('/appliances/1/plan?calendar=connected')
  })
})

describe('parseDrafts', () => {
  it('accepts the month-end clamp rule', () => {
    const rule = 'RRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=28,29,30,31;BYSETPOS=-1'
    expect(parseDrafts({ drafts: [{ ...draft, recurrence: [rule] }] })?.[0].recurrence).toEqual([rule])
  })

  it('accepts well-formed drafts and drops unknown fields', () => {
    expect(parseDrafts({ drafts: [{ ...draft, attendees: ['x@example.com'] }] })).toEqual([draft])
  })

  it.each([
    ['no drafts', {}],
    ['empty list', { drafts: [] }],
    ['bad date', { drafts: [{ ...draft, date: '2026-13-01' }] }],
    ['end before start', { drafts: [{ ...draft, endDate: '2026-10-05' }] }],
    ['foreign recurrence', { drafts: [{ ...draft, recurrence: ['RRULE:FREQ=SECONDLY'] }] }],
    ['unknown rule part', { drafts: [{ ...draft, recurrence: ['RRULE:FREQ=MONTHLY;COUNT=999'] }] }],
    ['too many', { drafts: Array.from({ length: 21 }, () => draft) }],
  ])('rejects %s', (_name, body) => {
    expect(parseDrafts(body)).toBeNull()
  })
})

describe('parseTaskRequest', () => {
  const id = '3f2b9c1e-1111-4222-8333-444455556666'

  it('accepts an appliance id and de-duplicated task ids', () => {
    expect(parseTaskRequest({ applianceId: id, taskIds: [id, id] })).toEqual({ applianceId: id, taskIds: [id] })
  })

  it.each([
    ['missing appliance', { taskIds: [id] }],
    ['non-uuid task', { applianceId: id, taskIds: ['task-1'] }],
    ['no tasks', { applianceId: id, taskIds: [] }],
  ])('rejects %s', (_name, body) => {
    expect(parseTaskRequest(body)).toBeNull()
  })
})

describe('bearerToken', () => {
  it('reads a bearer token', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def')
    expect(bearerToken('Basic abc')).toBeNull()
    expect(bearerToken(null)).toBeNull()
  })
})

describe('enforceSameOrigin', () => {
  const own = 'http://keeply.local'

  it('accepts a request whose Origin matches the request URL', () => {
    const request = new NextRequest(`${own}/api/calendar/events`, { headers: { origin: own } })
    expect(enforceSameOrigin(request)?.status ?? null).toBeNull()
  })

  it.each([
    ['missing Origin header', new NextRequest(`${own}/api/calendar/events`)],
    ['cross-origin request', new NextRequest(`${own}/api/calendar/events`, { headers: { origin: 'https://evil.example' } })],
  ])('returns 403 for %s', (_label, request) => {
    const response = enforceSameOrigin(request)
    expect(response?.status).toBe(403)
  })

  it('treats different schemes or ports as cross-origin', () => {
    const request = new NextRequest(`${own}/api/calendar/events`, { headers: { origin: 'http://keeply.local:8080' } })
    expect(enforceSameOrigin(request)?.status).toBe(403)
  })
})

describe('enforceJsonContentType', () => {
  it('accepts application/json', () => {
    const request = new NextRequest('http://keeply.local/api/calendar/events', { headers: { 'content-type': 'application/json' } })
    expect(enforceJsonContentType(request)?.status ?? null).toBeNull()
  })

  it('accepts application/json with a charset', () => {
    const request = new NextRequest('http://keeply.local/api/calendar/events', { headers: { 'content-type': 'application/json; charset=utf-8' } })
    expect(enforceJsonContentType(request)?.status ?? null).toBeNull()
  })

  it('returns 415 for text/plain (which request.json() would otherwise still parse)', () => {
    const request = new NextRequest('http://keeply.local/api/calendar/events', { headers: { 'content-type': 'text/plain' } })
    const out = enforceJsonContentType(request)
    expect(out?.status).toBe(415)
  })

  it('returns 415 when Content-Type is missing', () => {
    const request = new NextRequest('http://keeply.local/api/calendar/events')
    expect(enforceJsonContentType(request)?.status).toBe(415)
  })
})
