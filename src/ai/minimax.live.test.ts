import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { identifyWithMiniMax, MINIMAX_VISION_MODELS } from './minimax'

// VERIFICATION ONLY — never part of `pnpm test`, CI or the app. Run with `pnpm verify:minimax`.
// It talks to the real MiniMax API to answer one question: does this account's key accept image
// input to the configured model? The key is NOT read here: in a Claude cloud session the
// environment's API credential for api.minimax.io is injected by the egress proxy, so this test
// strips its own placeholder Authorization header and lets the proxy add the real one.
// Locally (no proxy), set MINIMAX_API_KEY in .env.local / the shell instead.
// Node's built-in fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (set by the script); without
// it the request skips the credential-injecting proxy and the sandbox firewall answers 403 itself.
const model = process.env.MINIMAX_MODEL?.trim() || 'MiniMax-M3'
const baseUrl = (process.env.MINIMAX_BASE_URL?.trim() || 'https://api.minimax.io/v1').replace(/\/+$/, '')
const localKey = process.env.MINIMAX_API_KEY?.trim()
const photoPath = process.env.KEEPLY_LABEL_PHOTO || 'public/icons/icon-512.png'

const viaProxy: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  if (!localKey) headers.delete('Authorization')
  const response = await fetch(input, { ...init, headers })
  // Tell a block by the session's egress proxy apart from a MiniMax rejection.
  if (response.status === 403) {
    const text = await response.clone().text()
    if (text.startsWith('Host not in allowlist')) throw new Error(`Egress proxy blocked the request before it reached MiniMax: ${text.slice(0, 80)}`)
  }
  return response
}

describe('MiniMax live (verification only)', () => {
  it('accepts image input for the configured model and returns Keeply’s schema', async () => {
    expect((MINIMAX_VISION_MODELS as readonly string[]).includes(model)).toBe(true)
    const bytes = new Uint8Array(readFileSync(photoPath))
    const mimeType = photoPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
    const identity = await identifyWithMiniMax({ apiKey: localKey ?? 'proxy-injected', model, baseUrl }, { bytes, mimeType }, viaProxy)
    // Prints only the parsed, neutral result — never headers or credentials.
    console.log(`[minimax live] ${model} via ${baseUrl}: ${JSON.stringify(identity)}`)
    expect(identity).not.toBeNull()
  }, 60_000)
})
