import { describe, expect, it } from 'vitest'
import { scanAccessMode } from './scan-gate'

describe('scanAccessMode', () => {
  it('defaults to invite-only', () => {
    expect(scanAccessMode({})).toBe('invite')
    expect(scanAccessMode({ KEEPLY_SCAN_ACCESS: 'yes' })).toBe('invite')
  })

  it('allows open access only outside Vercel Production', () => {
    expect(scanAccessMode({ KEEPLY_SCAN_ACCESS: 'open' })).toBe('open')
    expect(scanAccessMode({ KEEPLY_SCAN_ACCESS: 'open', VERCEL_ENV: 'preview' })).toBe('open')
    expect(scanAccessMode({ KEEPLY_SCAN_ACCESS: 'open', VERCEL_ENV: 'production' })).toBe('invite')
  })
})
