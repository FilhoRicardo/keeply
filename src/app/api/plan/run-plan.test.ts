import { afterEach, describe, expect, it, vi } from 'vitest'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import * as brave from '@/search/brave'
import * as planRunLog from '../../lib/plan-run-log'
import { runPlan } from './orchestration'

describe('runPlan time budget', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('returns before the platform limit and logs timedOut with elapsedMs when search runs out of budget', async () => {
    vi.useFakeTimers()
    const logSpy = vi.spyOn(planRunLog, 'logPlanRun').mockImplementation(() => {})
    vi.spyOn(brave, 'searchManuals').mockImplementation((_args, options = {}) => {
      expect(options.abortSignal).toBeDefined()
      return new Promise((resolve) => {
        const finish = () =>
          resolve({ status: 'empty' as const, candidates: [], reason: 'timeout' as const, braveStatus: [408] as const })
        if (options.abortSignal?.aborted) finish()
        else options.abortSignal?.addEventListener('abort', finish, { once: true })
      })
    })

    const pending = runPlan(
      { manufacturer: 'Electrolux', model: 'KEQB7300L', applianceType: 'dishwasher' },
      { BRAVE_SEARCH_API_KEY: 'key' },
    )
    await vi.advanceTimersByTimeAsync(25_000)
    const result = await pending

    expect(result.fallback).toBe('general')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
    expect(logSpy).toHaveBeenCalledOnce()
    expect(logSpy.mock.calls[0][0]).toMatchObject({
      type: 'plan_run',
      timedOut: true,
    })
    expect(logSpy.mock.calls[0][0].elapsedMs).toBeGreaterThanOrEqual(25_000)
  })
})
