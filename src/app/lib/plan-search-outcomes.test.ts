import { describe, expect, it } from 'vitest'
import type { ProposalMeta } from '@/domain/model'
import {
  emptySearchToPlanOutcome,
  isSearchErrorReason,
  proposalMetaForStorage,
  proposalMetaFromStorage,
} from './plan-search-outcomes'

describe('emptySearchToPlanOutcome', () => {
  it('maps a genuinely empty Brave result to search_empty', () => {
    expect(emptySearchToPlanOutcome('no_results')).toEqual({
      searchOutcome: 'search_empty',
      searchReason: 'no_results',
    })
  })

  it('maps Brave failures to search_error with the Brave reason', () => {
    expect(emptySearchToPlanOutcome('rate_limited')).toEqual({
      searchOutcome: 'search_error',
      searchReason: 'rate_limited',
    })
    expect(emptySearchToPlanOutcome('malformed_response')).toEqual({
      searchOutcome: 'search_error',
      searchReason: 'malformed_response',
    })
  })

  it('keeps quota_exhausted separate', () => {
    expect(emptySearchToPlanOutcome('quota_exhausted')).toEqual({
      searchOutcome: 'quota_exhausted',
      searchReason: 'quota_exhausted',
    })
  })
})

describe('isSearchErrorReason', () => {
  it('recognises Brave and HTTP status tokens', () => {
    expect(isSearchErrorReason('http_401')).toBe(true)
    expect(isSearchErrorReason('rate_limited')).toBe(true)
    expect(isSearchErrorReason('no_results')).toBe(false)
    expect(isSearchErrorReason('search_empty')).toBe(false)
  })
})

describe('proposal meta storage codec', () => {
  const base = (searchOutcome: ProposalMeta['searchOutcome'], searchReason: string | null): ProposalMeta => ({
    fallback: 'general',
    searchOutcome,
    searchReason,
    searched: true,
  })

  it('round-trips search_empty', () => {
    const live = base('search_empty', 'no_results')
    expect(proposalMetaFromStorage(proposalMetaForStorage(live))).toEqual(live)
  })

  it('round-trips search_error with HTTP status', () => {
    const live = base('search_error', 'http_403')
    expect(proposalMetaFromStorage(proposalMetaForStorage(live))).toEqual(live)
  })

  it('round-trips manual_found_ai_no_tasks', () => {
    const live = base('manual_found_ai_no_tasks', null)
    expect(proposalMetaFromStorage(proposalMetaForStorage(live))).toEqual(live)
  })
})
