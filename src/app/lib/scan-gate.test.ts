import { describe, expect, it } from 'vitest'
import { aiScanLive, scanAccessMode } from './scan-gate'

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

describe('aiScanLive', () => {
  it('requires the scan feature flag while recognising a configured personal key', () => {
    expect(aiScanLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1' }, true)).toBe(true)
    expect(aiScanLive({ NEXT_PUBLIC_KEEPLY_SCAN: '' }, true)).toBe(false)
    expect(aiScanLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1' }, false)).toBe(false)
  })
})
