import { describe, expect, it } from 'vitest'
import { noPlanRecovery, type NoPlanSignal } from './no-plan-recovery'

const NOTHING = /could not find suitable manufacturer guidance/i
const CHECK_IDENTITY = /appliance type, manufacturer, and model/i
const MANUAL = /couldn’t create a supported plan from this manual/i
const LATER = /try again later/i
const GENERIC = /could not create a supported maintenance plan/i
const UNSAFE = /unsafe/i
const NO_MANUAL_EXISTS = /no manufacturer manual/i

function recovery(signal: NoPlanSignal | null | undefined) {
  return noPlanRecovery(signal)
}

describe('no-plan recovery mapping', () => {
  it.each([
    ['no_results', null],
    [null, 'no_results'],
    ['no_plan', 'no_results'],
  ] as const)('maps outcome %s / reason %s to nothing suitable found', (searchOutcome, searchReason) => {
    const result = recovery({ searchOutcome, searchReason })
    expect(result.category).toBe('nothing_suitable')
    expect(result.message).toMatch(NOTHING)
    expect(result.message).toMatch(CHECK_IDENTITY)
    expect(result.message).not.toMatch(UNSAFE)
  })

  it.each(['fetch_failed', 'unreadable', 'no_text'] as const)(
    'maps %s to neutral manual-information copy',
    (token) => {
      const result = recovery({ searchOutcome: token, searchReason: 'no_plan' })
      expect(result.category).toBe('manual_information')
      expect(result.message).toMatch(MANUAL)
      expect(result.message).not.toMatch(UNSAFE)
      expect(result.message).not.toMatch(NO_MANUAL_EXISTS)
    },
  )

  it.each(['extraction_unavailable', 'timeout'] as const)(
    'says manuals were found but could not be read for %s',
    (token) => {
      const fromOutcome = recovery({ searchOutcome: token, searchReason: 'no_plan' })
      const fromReason = recovery({ searchOutcome: 'no_plan', searchReason: token })
      for (const result of [fromOutcome, fromReason]) {
        expect(result.category).toBe('temporary')
        expect(result.message).toBe('Keeply found manuals but could not read them right now. Try again later.')
        expect(result.message).not.toMatch(NO_MANUAL_EXISTS)
        expect(result.message).not.toMatch(/dishwasher/i)
        expect(result.message).not.toMatch(UNSAFE)
      }
    },
  )

  it.each([
    'quota_exhausted',
    'network_error',
    'http_error',
    'http_408',
    'http_429',
    'http_500',
    'http_503',
    'rate_limited',
    'malformed_response',
  ] as const)('maps %s to a temporary limitation', (token) => {
    const result = recovery({ searchOutcome: 'no_plan', searchReason: token })
    expect(result.category).toBe('temporary')
    expect(result.message).toMatch(LATER)
    expect(result.message).not.toMatch(CHECK_IDENTITY)
    expect(result.message).not.toMatch(NO_MANUAL_EXISTS)
    expect(result.message).not.toMatch(UNSAFE)
  })

  it.each([
    { searchOutcome: 'no_plan', searchReason: 'no_plan' },
    { searchOutcome: 'unavailable', searchReason: null },
    { searchOutcome: 'unavailable', searchReason: 'plan_search_disabled' },
    { searchOutcome: 'unavailable', searchReason: 'plan_search_refused' },
    { searchOutcome: 'no_plan', searchReason: 'no_key' },
    { searchOutcome: null, searchReason: null },
    { searchOutcome: 'made_up', searchReason: 'also_made_up' },
  ] as const)('maps $searchOutcome / $searchReason to generic inability', (signal) => {
    const result = recovery(signal)
    expect(result.category).toBe('generic')
    expect(result.message).toMatch(GENERIC)
    expect(result.message).toMatch(LATER)
    expect(result.message).not.toMatch(NO_MANUAL_EXISTS)
    expect(result.message).not.toMatch(UNSAFE)
  })

  it.each(['http_400', 'http_401', 'http_422'] as const)(
    'maps %s to a details check the owner can correct',
    (token) => {
      const result = recovery({ searchOutcome: 'unavailable', searchReason: token })
      expect(result.category).toBe('invalid_request')
      expect(result.message).toMatch(CHECK_IDENTITY)
      expect(result.message).not.toMatch(LATER)
      expect(result.message).not.toMatch(NO_MANUAL_EXISTS)
      expect(result.message).not.toMatch(UNSAFE)
    },
  )

  it('treats a missing result as generic inability', () => {
    expect(recovery(null).category).toBe('generic')
    expect(recovery(undefined).category).toBe('generic')
    expect(recovery(null).message).toMatch(GENERIC)
  })
})
