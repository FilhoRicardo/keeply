import { describe, expect, it } from 'vitest'
import { searchReasonForClient } from './orchestration'

describe('searchReasonForClient', () => {
  it('keeps a search-step timeout on a saved dishwasher plan', () => {
    expect(
      searchReasonForClient({
        proposals: [{ name: 'Clean the filter' }],
        searchOutcome: 'timeout',
        searchReason: 'timeout',
      }),
    ).toBe('timeout')
  })

  it('drops other reasons once general-guidance tasks were saved', () => {
    expect(
      searchReasonForClient({
        proposals: [{ name: 'Clean the filter' }],
        searchOutcome: 'ok',
        searchReason: 'no_key',
      }),
    ).toBe(null)
    expect(
      searchReasonForClient({
        proposals: [{ name: 'Clean the filter' }],
        searchOutcome: 'quota_exhausted',
        searchReason: 'quota_exhausted',
      }),
    ).toBe(null)
    expect(
      searchReasonForClient({
        proposals: [{ name: 'Clean the filter' }],
        searchOutcome: 'ok',
        searchReason: null,
      }),
    ).toBe(null)
  })

  it('keeps the reason when nothing was saved', () => {
    expect(
      searchReasonForClient({ proposals: [], searchOutcome: 'search_error', searchReason: 'timeout' }),
    ).toBe('timeout')
    expect(
      searchReasonForClient({ proposals: [], searchOutcome: 'search_error', searchReason: 'rate_limited' }),
    ).toBe('rate_limited')
    expect(
      searchReasonForClient({ proposals: [], searchOutcome: 'search_empty', searchReason: null }),
    ).toBe(null)
  })

  it('keeps search reasons when general guidance was saved after an honest search failure', () => {
    const general = [{ name: 'Clean the filter' }]
    expect(
      searchReasonForClient({
        proposals: general,
        searchOutcome: 'search_error',
        searchReason: 'http_401',
      }),
    ).toBe('http_401')
    expect(
      searchReasonForClient({
        proposals: general,
        searchOutcome: 'search_empty',
        searchReason: 'no_results',
      }),
    ).toBe('no_results')
    expect(
      searchReasonForClient({
        proposals: general,
        searchOutcome: 'manual_found_ai_no_tasks',
        searchReason: null,
      }),
    ).toBe(null)
  })
})
