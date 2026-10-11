// Test-only switch for the full-journey e2e. Same rule as KEEPLY_SCAN_ACCESS:
// a production deployment ignores it, so the flag cannot turn on fixture traffic there.
export function e2eFixturesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false
  return env.KEEPLY_E2E_FIXTURES === '1'
}
