import { describe, expect, it, vi } from 'vitest'

async function headersFor(env: string) {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', env)
  const { securityHeaders } = await import('../../next.config')
  vi.unstubAllEnvs()
  return Object.fromEntries(securityHeaders.map((h) => [h.key, h.value]))
}

describe('security headers', () => {
  it('ships a CSP without unsafe-eval in production', async () => {
    const csp = (await headersFor('production'))['Content-Security-Policy']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).toContain('https://*.supabase.co')
    expect(csp).not.toContain('unsafe-eval')
  })

  it('denies framing and sniffing', async () => {
    const headers = await headersFor('production')
    expect(headers['X-Frame-Options']).toBe('DENY')
    expect(headers['X-Content-Type-Options']).toBe('nosniff')
  })
})
