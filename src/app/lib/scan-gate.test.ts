import { NextRequest } from 'next/server'
import { describe, expect, it, vi } from 'vitest'
import { admitScan, aiScanLive, scanAccessMode } from './scan-gate'

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

// Hosted vertical slice: invite mode + operator keys + pooled quota in Postgres (docs/testers.md).
describe('admitScan (hosted invite gate)', () => {
  const hostedEnv = {
    KEEPLY_SCAN_ACCESS: 'invite',
    VERCEL_ENV: 'production',
    NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
  }

  it('allows without Supabase only in non-production open mode', async () => {
    const req = new NextRequest('http://keeply.local/api/identify')
    expect(await admitScan(req, { KEEPLY_SCAN_ACCESS: 'open', VERCEL_ENV: 'preview' })).toBe('allowed')
  })

  it('fails closed in production invite mode without a session', async () => {
    const req = new NextRequest('http://keeply.local/api/identify')
    expect(await admitScan(req, hostedEnv)).toBe('unavailable')
  })

  it('delegates to reserve_scan via the caller session and never throws', async () => {
    const reserve = vi.fn().mockResolvedValue('daily_limit')
    const req = new NextRequest('http://keeply.local/api/identify', {
      headers: { Authorization: 'Bearer session-jwt' },
    })
    expect(await admitScan(req, hostedEnv, reserve)).toBe('daily_limit')
    expect(reserve).toHaveBeenCalledOnce()
  })

  it('maps reservation errors to unavailable (no provider call)', async () => {
    const reserve = vi.fn().mockRejectedValue(new Error('Supabase: down'))
    const req = new NextRequest('http://keeply.local/api/identify', {
      headers: { Authorization: 'Bearer session-jwt' },
    })
    expect(await admitScan(req, hostedEnv, reserve)).toBe('unavailable')
  })
})
