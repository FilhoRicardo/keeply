import { describe, expect, it } from 'vitest'
import { bearerToken, parseDrafts, parseTaskRequest, safeReturnTo, withQuery } from './calendar-session'

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
    ['/appliances/1/approve', '/appliances/1/approve'],
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
    expect(withQuery('/appliances/1/approve', 'calendar', 'connected')).toBe('/appliances/1/approve?calendar=connected')
  })
})

describe('parseDrafts', () => {
  it('accepts well-formed drafts and drops unknown fields', () => {
    expect(parseDrafts({ drafts: [{ ...draft, attendees: ['x@example.com'] }] })).toEqual([draft])
  })

  it.each([
    ['no drafts', {}],
    ['empty list', { drafts: [] }],
    ['bad date', { drafts: [{ ...draft, date: '2026-13-01' }] }],
    ['end before start', { drafts: [{ ...draft, endDate: '2026-10-05' }] }],
    ['foreign recurrence', { drafts: [{ ...draft, recurrence: ['RRULE:FREQ=SECONDLY'] }] }],
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
