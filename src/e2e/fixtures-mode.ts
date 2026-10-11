// Test-only switch for the full-journey e2e (RF-353). Same production lock as
// KEEPLY_SCAN_ACCESS=open: a Vercel Production deployment ignores the flag even if
// the variable is set. The value is never a secret. See docs/environments.md.
export function e2eFixturesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL_ENV === 'production') return false
  return env.KEEPLY_E2E_FIXTURES === '1'
}
