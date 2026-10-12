import { describe, expect, it } from 'vitest'
import { e2eFixturesEnabled } from './guard'

describe('e2eFixturesEnabled', () => {
  it('stays off unless the flag is exactly 1', () => {
    expect(e2eFixturesEnabled({})).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: 'true' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: 'open' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1' })).toBe(true)
  })

  it('is ignored on every Vercel deployment', () => {
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: 'production' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: 'preview' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1', VERCEL: '1' })).toBe(false)
  })
})
