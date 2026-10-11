import { fixtureResponse } from './edge-fetch'
import { e2eFixturesEnabled } from './guard'

let installed = false

// Catches a server fetch that does not go through withE2eFixtures. Call sites that already
// wrap their fetch still answer first, so a calendar write is recorded once.
// Production never wraps fetch: the flag is ignored when VERCEL_ENV=production.
export function installE2eFetch(): void {
  if (installed || !e2eFixturesEnabled()) return
  installed = true
  const original = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const fake = fixtureResponse(input, init)
    if (fake) return fake
    return original(input, init)
  }) as typeof fetch
}
