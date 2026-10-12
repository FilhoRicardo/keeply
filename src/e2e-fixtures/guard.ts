// Test-only switch for the full-journey e2e. It fakes AI, search and Google Calendar, so any
// Vercel deployment (production or preview) ignores it. Only a local or CI server can turn it on.
export function e2eFixturesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL || env.VERCEL_ENV) return false
  return env.KEEPLY_E2E_FIXTURES === '1'
}
