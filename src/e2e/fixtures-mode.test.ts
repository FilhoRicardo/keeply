import { describe, expect, it } from 'vitest'
import { e2eFixturesEnabled } from './fixtures-mode'

describe('e2eFixturesEnabled', () => {
  it('stays off unless the flag is exactly 1', () => {
    expect(e2eFixturesEnabled({})).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: 'yes' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1' })).toBe(true)
  })

  it('is ignored in Vercel Production, including when the flag is set', () => {
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: 'production' })).toBe(false)
    expect(e2eFixturesEnabled({ KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: 'preview' })).toBe(true)
  })
})
