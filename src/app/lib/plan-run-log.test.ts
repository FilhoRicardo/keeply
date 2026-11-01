import { describe, expect, it, vi } from 'vitest'
import { logPlanRun } from './plan-run-log'

describe('logPlanRun', () => {
  it('writes timedOut and elapsedMs on the counts-only plan_run line', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logPlanRun({
      type: 'plan_run',
      braveStatus: [200],
      candidates: 3,
      coverMatches: 1,
      aiTasks: 0,
      quotePass: 0,
      outcome: 'timeout',
      timedOut: true,
      elapsedMs: 25_012,
    })
    expect(JSON.parse(String(spy.mock.calls[0][0]))).toMatchObject({
      type: 'plan_run',
      timedOut: true,
      elapsedMs: 25_012,
      outcome: 'timeout',
    })
    spy.mockRestore()
  })
})
