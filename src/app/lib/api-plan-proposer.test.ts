import { afterEach, describe, expect, it, vi } from 'vitest'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import { createApiPlanProposer, fallbackReason } from './api-plan-proposer'

// KEE-43: the live proposer is the thin client that calls /api/plan. It returns the verified or
// general-guidance proposals plus the outcome (fallback, searchOutcome, searchReason) the plan
// screen uses to render an honest message. The test covers the three response shapes the route
// can return: a verified plan, a general-guidance fallback, and a disabled route (404).

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const manufacturer = 'Bosch'
const model = 'SMS6ZCI49E'

const VERIFIED_BODY = {
  proposals: [
    {
      name: 'Clean the filter',
      instructions: 'Twist out the filter, rinse under warm water, refit.',
      interval: { count: 1, unit: 'month' },
      evidenceLevel: 'manufacturer_verified',
      source: {
        type: 'manufacturer_manual',
        title: 'Bosch SMS6ZCI49E user manual',
        url: 'https://www.bosch-home.com/manual.pdf',
        location: 'page 32',
        quote: 'Clean the filter once a month under running water.',
      },
    },
  ],
  fallback: 'exact',
  searchOutcome: 'ok',
  searchReason: null,
}

const FALLBACK_BODY = {
  proposals: GENERAL_DISHWASHER_TASKS.map((p) => ({ ...p })),
  fallback: 'general',
  searchOutcome: 'no_results',
  searchReason: 'no_key',
}

afterEach(() => vi.unstubAllGlobals())

describe('createApiPlanProposer', () => {
  it('returns verified proposals and the ok outcome', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(VERIFIED_BODY))
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    const result = await propose({ manufacturer, model })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/plan',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(result.searched).toBe(true)
    expect(result.outcome.fallback).toBe('exact')
    expect(result.outcome.searchOutcome).toBe('ok')
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    expect(result.proposals[0].source.quote).toBe('Clean the filter once a month under running water.')
    expect(result.proposals[0].source.location).toBe('page 32')
    expect(result.proposals[0].source.url).toBe('https://www.bosch-home.com/manual.pdf')
  })

  it('keeps the covered model on a similar-model proposal', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        proposals: [
          {
            name: 'Clean the filter',
            instructions: 'Rinse it.',
            interval: { count: 1, unit: 'month' },
            evidenceLevel: 'similar_model',
            source: {
              type: 'similar_model_manual',
              title: 'Smeg DI6012 series',
              url: 'https://www.smeg.com/di6012.pdf',
              location: 'page 18',
              quote: 'Clean the filter once a month under running water.',
              coveredModel: 'DI6012-2',
            },
          },
        ],
        fallback: 'similar',
        searchOutcome: 'ok',
        searchReason: null,
      }),
    )
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    const result = await propose({ manufacturer, model })
    expect(result.proposals[0].evidenceLevel).toBe('similar_model')
    expect(result.proposals[0].source.coveredModel).toBe('DI6012-2')
    expect(result.proposals[0].source.location).toBe('page 18')
  })

  it('returns general-guidance proposals and the no_results outcome on fallback', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(FALLBACK_BODY))
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    const result = await propose({ manufacturer, model })

    expect(result.searched).toBe(true)
    expect(result.outcome.fallback).toBe('general')
    expect(result.outcome.searchOutcome).toBe('no_results')
    expect(result.outcome.searchReason).toBe('no_key')
    expect(result.proposals.length).toBe(GENERAL_DISHWASHER_TASKS.length)
    expect(result.proposals.every((p) => p.evidenceLevel === 'general_guidance')).toBe(true)
  })

  it('returns an empty plan when the route is disabled (404)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'not_enabled' }, 404))
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    const result = await propose({ manufacturer, model })

    expect(result.searched).toBe(false)
    expect(result.outcome.fallback).toBe('general')
    expect(result.outcome.searchOutcome).toBe('unavailable')
    expect(result.outcome.searchReason).toBe('plan_search_disabled')
    expect(result.proposals).toEqual([])
  })

  it('returns an empty plan when the visitor is refused (403)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: 'plan_denied' }, 403))
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    const result = await propose({ manufacturer, model })

    expect(result.searched).toBe(false)
    expect(result.outcome.searchReason).toBe('plan_search_refused')
  })

  it('returns an empty plan on a network error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('network down')
    })
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    const result = await propose({ manufacturer, model })

    expect(result.searched).toBe(false)
    expect(result.outcome.searchReason).toBe('network_error')
  })

  it('passes the trimmed model through (empty model is allowed)', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse(FALLBACK_BODY)
    })
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    await propose({ manufacturer, model: null })

    expect(calls).toHaveLength(1)
    const init = calls[0].init as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ manufacturer, model: '' })
  })

  it('sends the appliance type so a dishwasher is not planned as an unknown appliance', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return jsonResponse(FALLBACK_BODY)
    })
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    await propose({ manufacturer, model, applianceType: 'Dishwasher' })

    const init = calls[0].init as RequestInit
    expect(JSON.parse(init.body as string)).toEqual({ manufacturer, model, applianceType: 'Dishwasher' })
  })

  it('rejects malformed proposals gracefully and reports an empty list', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        proposals: [
          { name: 'broken', instructions: 'x' }, // missing interval/source/level
        ],
        fallback: 'general',
        searchOutcome: 'no_results',
        searchReason: null,
      }),
    )
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    const result = await propose({ manufacturer, model })

    expect(result.proposals).toEqual([])
    expect(result.outcome.fallback).toBe('general')
  })
})

describe('createApiPlanProposer session token', () => {
  it('sends the visitor session as a bearer token, which /api/plan requires to search', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(VERIFIED_BODY))
    const propose = createApiPlanProposer({
      fetch: fetchMock as unknown as typeof fetch,
      accessToken: async () => 'session-token',
    })
    await propose({ manufacturer, model })

    const init = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer session-token' })
  })

  it('sends no Authorization header when there is no session', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(VERIFIED_BODY))
    const propose = createApiPlanProposer({ fetch: fetchMock as unknown as typeof fetch })
    await propose({ manufacturer, model })

    const init = (fetchMock.mock.calls as unknown as [string, RequestInit][])[0][1]
    expect(init.headers).not.toHaveProperty('Authorization')
  })
})

describe('fallbackReason', () => {
  it('maps known outcomes to a stable, UI-friendly reason', () => {
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'ok', searchReason: null })).toBe('no_manual_needed')
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'quota_exhausted', searchReason: null })).toBe('quota_exhausted')
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'no_results', searchReason: 'no_key' })).toBe('no_search_key')
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'unavailable', searchReason: 'plan_search_disabled' })).toBe('plan_search_disabled')
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'unavailable', searchReason: 'network_error' })).toBe('network_error')
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'fetch_failed', searchReason: null })).toBe('fetch_failed')
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'unavailable', searchReason: 'http_504' })).toBe('plan_time_budget')
    expect(fallbackReason({ fallback: 'general', searchOutcome: 'unavailable', searchReason: 'http_502' })).toBe('service_error')
  })
})
