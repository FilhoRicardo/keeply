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
  it('requires the scan feature flag and an OpenRouter key', () => {
    expect(aiScanLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1' })).toBe(false)
    expect(aiScanLive({ NEXT_PUBLIC_KEEPLY_SCAN: '' })).toBe(false)
    expect(aiScanLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1', OPENROUTER_API_KEY: 'or-key' })).toBe(true)
    expect(aiScanLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1', MINIMAX_API_KEY: 'leftover' })).toBe(false)
  })
})
