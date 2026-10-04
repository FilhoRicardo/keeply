import { describe, expect, it } from 'vitest'
import { soonestTask } from './appliance-list'
import { addAppliance, approve, EMPTY_STATE, findRecord, setDecision } from './lib/plan-state'

describe('soonestTask', () => {
  it('picks the approved task due first, ignoring skipped ones', () => {
    let state = addAppliance(EMPTY_STATE, { manufacturer: 'Bosch', model: '', serialNumber: '' }, 'a', 'now')
    const [filter, cycle, arms] = findRecord(state, 'a')!.recommendations
    state = setDecision(state, 'a', filter.id, {
      kind: 'customise',
      interval: { count: 1, unit: 'month' },
      startDate: '2026-11-20',
      schedulingMode: 'fixed_calendar',
    })
    state = setDecision(state, 'a', cycle.id, { kind: 'include' })
    state = setDecision(state, 'a', arms.id, { kind: 'skip' })
    let n = 0
    state = approve(state, 'a', '2026-11-01', () => `t${++n}`, 'now')
    expect(soonestTask(findRecord(state, 'a')!)).toEqual({ name: 'Run a cleaning cycle', due: '2026-11-01' })
  })
})
