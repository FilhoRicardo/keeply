import { describe, expect, it } from 'vitest'
import { e2eFixturesEnabled } from './guard'

describe('e2eFixturesEnabled', () => {
  it('stays off unless the flag is exactly 1', () => {
    expect(e2eFixturesEnabled({})).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: 'true' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: 'open' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1' })).toBe(true)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: 'preview' })).toBe(true)
  })

  it('is ignored in Vercel Production', () => {
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: 'production' })).toBe(false)
  })
})
