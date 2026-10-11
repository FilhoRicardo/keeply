import { beforeEach, describe, expect, it, vi } from 'vitest'
import { planFallbackReason } from '../../components/plan-fallback-banner'

// RF-351: a dishwasher fallback still has tasks, so the route must keep a search-phase
// timeout on the response. Otherwise the saved plan banner classifies from searchOutcome
// alone and says manuals were found.

const proposePlan = vi.fn()
vi.mock('../../lib/plan-orchestration', () => ({
  CANDIDATE_FETCH_TIMEOUT_MS: 8_000,
  proposePlan: (...args: unknown[]) => proposePlan(...args),
}))

import { runPlan } from './orchestration'

const GENERAL = {
  name: 'Clean the filter',
  instructions: 'Rinse it.',
  interval: { count: 1, unit: 'month' as const },
  evidenceLevel: 'general_guidance' as const,
  source: {
    type: 'general_guidance' as const,
    title: 'Keeply general dishwasher maintenance guidance',
    url: null,
    location: null,
    quote: null,
  },
}

beforeEach(() => {
  proposePlan.mockReset()
})

describe('runPlan search reason on a saved dishwasher plan', () => {
  it.each([
    {
      stop: 'budget ended before the search ran',
      searchOutcome: 'timeout' as const,
      searchReason: 'timeout',
      reason: 'search_timeout',
    },
    {
      stop: 'manual search timed out before it returned a candidate',
      searchOutcome: 'no_results' as const,
      searchReason: 'timeout',
      reason: 'search_timeout',
    },
    {
      stop: 'budget ended after manuals were found',
      searchOutcome: 'timeout' as const,
      searchReason: null,
      reason: 'timeout',
    },
  ])('$stop stays visible after the route returns proposals', async ({ searchOutcome, searchReason, reason }) => {
    proposePlan.mockResolvedValueOnce({
      proposals: [GENERAL],
      fallback: 'general',
      searchOutcome,
      searchReason,
    })
    const result = await runPlan({ manufacturer: 'Bosch', model: 'SMS6ZCI49E', applianceType: 'dishwasher' }, {})
    expect(result.proposals).toHaveLength(1)
    expect(result.searchOutcome).toBe(searchOutcome)
    expect(result.searchReason).toBe(searchReason)
    expect(
      planFallbackReason({
        fallback: result.fallback,
        searchOutcome: result.searchOutcome,
        searchReason: result.searchReason,
        searched: true,
      }),
    ).toBe(reason)
  })

  it('still drops a non-timeout reason when a dishwasher fallback has tasks', async () => {
    proposePlan.mockResolvedValueOnce({
      proposals: [GENERAL],
      fallback: 'general',
      searchOutcome: 'no_results',
      searchReason: 'no_key',
    })
    const result = await runPlan({ manufacturer: 'Bosch', model: 'SMS6ZCI49E', applianceType: 'dishwasher' }, {})
    expect(result.searchReason).toBe(null)
  })
})
