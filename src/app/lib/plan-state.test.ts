import { describe, expect, it } from 'vitest'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import { frozen } from '@/domain/test-fixtures'
import { addAppliance, approve, decide, EMPTY_STATE, findRecord, parseState, recordCalendarResults } from './plan-state'

function ids() {
  let n = 0
  return () => `id-${++n}`
}

const input = { manufacturer: ' Bosch ', model: ' ', serialNumber: '' }

function added() {
  return addAppliance(EMPTY_STATE, input, GENERAL_DISHWASHER_TASKS, ids(), 'now')
}

describe('plan state', () => {
  it('adds a dishwasher with its proposed tasks, nothing decided', () => {
    const { state, applianceId } = added()
    const record = findRecord(state, applianceId)!
    expect(record.appliance).toMatchObject({ manufacturer: 'Bosch', model: null, serialNumber: null, identificationConfidence: null })
    expect(record.tasks.map((t) => [t.name, t.status])).toEqual([
      ['Clean the filter', 'proposed'],
      ['Run a cleaning cycle', 'proposed'],
      ['Check the spray arms', 'proposed'],
    ])
    expect(record.approvedAt).toBeNull()
  })

  it('requires a manufacturer and at least one proposal', () => {
    expect(() => addAppliance(EMPTY_STATE, { ...input, manufacturer: ' ' }, GENERAL_DISHWASHER_TASKS, ids(), 'now')).toThrow(/manufacturer/)
    expect(() => addAppliance(EMPTY_STATE, input, [], ids(), 'now')).toThrow(/at least one/)
  })

  it('approves without touching the proposals, then freezes decisions', () => {
    const { state, applianceId } = added()
    const [a, b, c] = findRecord(state, applianceId)!.tasks
    let next = frozen(decide(decide(decide(state, applianceId, a.id, 'accepted'), applianceId, b.id, 'rejected'), applianceId, c.id, 'rejected'))
    next = approve(next, applianceId, '2026-10-05', 'later')
    const record = findRecord(next, applianceId)!
    expect(record.tasks[0]).toEqual({ ...a, status: 'accepted' })
    expect(record).toMatchObject({ approvedAt: 'later', startDate: '2026-10-05' })
    expect(() => decide(next, applianceId, a.id, 'rejected')).toThrow(/already approved/)
  })

  it('records event ids only for successful writes on accepted tasks of an approved plan', () => {
    const { state, applianceId } = added()
    const [a, b, c] = findRecord(state, applianceId)!.tasks
    const decided = decide(decide(decide(state, applianceId, a.id, 'accepted'), applianceId, b.id, 'rejected'), applianceId, c.id, 'accepted')
    const results = [
      { taskId: a.id, ok: true as const, eventId: 'evt-a' },
      { taskId: b.id, ok: true as const, eventId: 'evt-b' },
      { taskId: c.id, ok: false as const, error: 'boom' },
    ]
    expect(findRecord(recordCalendarResults(decided, applianceId, results), applianceId)!.tasks.every((t) => !t.calendarEventId)).toBe(true)
    const approved = approve(decided, applianceId, '2026-10-05', 'now')
    const events = findRecord(recordCalendarResults(approved, applianceId, results), applianceId)!.tasks.map((t) => t.calendarEventId)
    expect(events).toEqual(['evt-a', null, null])
  })

  it('falls back to empty state on missing, old or corrupt storage', () => {
    expect(parseState(null)).toEqual(EMPTY_STATE)
    expect(parseState('{oops')).toEqual(EMPTY_STATE)
    expect(parseState(JSON.stringify({ version: 1, records: [{}] }))).toEqual(EMPTY_STATE)
  })
})
