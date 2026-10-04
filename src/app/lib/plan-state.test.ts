import { describe, expect, it } from 'vitest'
import {
  addAppliance,
  addCompletion,
  approve,
  EMPTY_STATE,
  findRecord,
  parseState,
  recordCalendarResults,
  setDecision,
} from './plan-state'

const NOW = '2026-10-04T10:00:00Z'

function ids() {
  let n = 0
  return () => `task-${++n}`
}

function withAppliance() {
  return addAppliance(EMPTY_STATE, { manufacturer: ' Bosch ', model: 'SMS6ZCI49E', serialNumber: '' }, 'app-1', NOW)
}

function decideAll(state = withAppliance()) {
  const [a, b, c] = findRecord(state, 'app-1')!.recommendations
  state = setDecision(state, 'app-1', a.id, { kind: 'include' })
  state = setDecision(state, 'app-1', b.id, {
    kind: 'customise',
    interval: { count: 2, unit: 'month' },
    startDate: '2026-10-10',
    schedulingMode: 'completion_based',
  })
  return setDecision(state, 'app-1', c.id, { kind: 'skip' })
}

describe('plan state', () => {
  it('adds a dishwasher with three proposed recommendations and no decisions', () => {
    const record = findRecord(withAppliance(), 'app-1')!
    expect(record.appliance).toMatchObject({ category: 'dishwasher', manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: null })
    expect(record.recommendations).toHaveLength(3)
    expect(record.decisions).toEqual({})
    expect(record.tasks).toEqual([])
  })

  it('requires a manufacturer', () => {
    expect(() => addAppliance(EMPTY_STATE, { manufacturer: ' ', model: '', serialNumber: '' }, 'x', NOW)).toThrow(/manufacturer/)
  })

  it('creates no tasks until approval', () => {
    expect(findRecord(decideAll(), 'app-1')!.tasks).toEqual([])
  })

  it('approves into tasks without touching the recommendations', () => {
    const before = decideAll()
    const recs = findRecord(before, 'app-1')!.recommendations
    const after = approve(before, 'app-1', '2026-10-05', ids(), NOW)
    const record = findRecord(after, 'app-1')!

    expect(record.recommendations).toEqual(recs)
    expect(record.approvedAt).toBe(NOW)
    expect(record.tasks.map((t) => [t.status, t.userInterval.count, t.userInterval.unit])).toEqual([
      ['approved', 1, 'month'],
      ['approved', 2, 'month'],
      ['skipped', 3, 'month'],
    ])
  })

  it('freezes decisions after approval', () => {
    const approved = approve(decideAll(), 'app-1', '2026-10-05', ids(), NOW)
    const rec = findRecord(approved, 'app-1')!.recommendations[0]
    expect(() => setDecision(approved, 'app-1', rec.id, { kind: 'skip' })).toThrow(/already approved/)
    expect(() => approve(approved, 'app-1', '2026-10-05', ids(), NOW)).toThrow(/already approved/)
  })

  it('records event ids only for successful writes on approved tasks', () => {
    const approved = approve(decideAll(), 'app-1', '2026-10-05', ids(), NOW)
    const next = recordCalendarResults(approved, 'app-1', [
      { taskId: 'task-1', ok: true, eventId: 'evt-1' },
      { taskId: 'task-2', ok: false, error: 'boom' },
      { taskId: 'task-3', ok: true, eventId: 'evt-3' },
    ])
    expect(findRecord(next, 'app-1')!.tasks.map((t) => t.calendarEventId)).toEqual(['evt-1', null, null])
  })

  it('records completions only for approved tasks', () => {
    const approved = approve(decideAll(), 'app-1', '2026-10-05', ids(), NOW)
    const done = addCompletion(approved, 'app-1', 'task-2', '2026-10-12')
    expect(findRecord(done, 'app-1')!.completions).toEqual([{ taskId: 'task-2', completedOn: '2026-10-12', notes: null }])
    expect(() => addCompletion(approved, 'app-1', 'task-3', '2026-10-12')).toThrow()
  })

  it('falls back to empty state on missing or corrupt storage', () => {
    expect(parseState(null)).toBe(EMPTY_STATE)
    expect(parseState('{nope')).toBe(EMPTY_STATE)
    expect(parseState('{"version":2}')).toBe(EMPTY_STATE)
    expect(parseState(JSON.stringify(withAppliance())).records).toHaveLength(1)
  })
})
