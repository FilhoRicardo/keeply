import { describe, expect, it } from 'vitest'
import { searchReasonForClient } from './orchestration'

describe('searchReasonForClient', () => {
  it('keeps a search-step timeout on a saved dishwasher plan', () => {
    expect(searchReasonForClient({ proposals: [{ name: 'Clean the filter' }], searchReason: 'timeout' })).toBe('timeout')
  })

  it('drops other reasons once general-guidance tasks were saved', () => {
    expect(searchReasonForClient({ proposals: [{ name: 'Clean the filter' }], searchReason: 'no_key' })).toBe(null)
    expect(searchReasonForClient({ proposals: [{ name: 'Clean the filter' }], searchReason: 'quota_exhausted' })).toBe(null)
    expect(searchReasonForClient({ proposals: [{ name: 'Clean the filter' }], searchReason: null })).toBe(null)
  })

  it('keeps the reason when nothing was saved', () => {
    expect(searchReasonForClient({ proposals: [], searchReason: 'timeout' })).toBe('timeout')
    expect(searchReasonForClient({ proposals: [], searchReason: 'rate_limited' })).toBe('rate_limited')
    expect(searchReasonForClient({ proposals: [], searchReason: null })).toBe(null)
  })
})
