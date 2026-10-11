import { e2eFixturesEnabled } from './guard'
import { FIXTURE_MANUAL_IP, MANUAL_URL, manualHtml } from './fixtures'

// The manual download uses node:https, not global fetch. This is the stand-in for that
// socket: the SSRF checks still run, and the bytes are the fixture manual.

export function e2eManualAddresses(host: string, env: Record<string, string | undefined> = process.env): string[] | null {
  if (!e2eFixturesEnabled(env)) return null
  if (host.toLowerCase() !== new URL(MANUAL_URL).hostname) return null
  return [FIXTURE_MANUAL_IP]
}

export function e2eManualResponse(url: string, env: Record<string, string | undefined> = process.env): Response | null {
  if (!e2eFixturesEnabled(env)) return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.href !== MANUAL_URL) return null
  return new Response(manualHtml(), {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
