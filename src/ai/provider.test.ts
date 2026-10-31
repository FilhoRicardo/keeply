import { describe, expect, it, vi } from 'vitest'
import { CANDIDATES, manualProvider, selectProvider, type AiCandidate } from './provider'

const fake = (kind: AiCandidate['kind'], available: boolean | 'throws'): AiCandidate => ({
  kind,
  available: () => {
    if (available === 'throws') throw new Error('misconfigured')
    return available
  },
  create: () => ({ kind, identifyAppliance: async () => null, extractTasks: async () => 'unavailable' }),
})

const photo = { bytes: new Uint8Array([1]), mimeType: 'image/jpeg' as const }
const pages = [{ page: 1, text: 'Clean the filter every month.' }]

function hostsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return (fetchMock.mock.calls as unknown as [string][]).map(([url]) => new URL(url).hostname)
}

describe('selectProvider', () => {
  it('keeps the documented order with Manual last and MiniMax absent', () => {
    expect(CANDIDATES.map((c) => c.kind)).toEqual([
      'chatgpt_authorized',
      'openrouter',
      'openai_api',
      'anthropic_api',
      'keeply_hosted',
      'manual',
    ])
  })

  it('uses OpenRouter when its key is set, and Manual when it is not, ignoring a MiniMax key', () => {
    expect(selectProvider({ env: { OPENROUTER_API_KEY: 'or-key' } }).kind).toBe('openrouter')
    expect(selectProvider({ env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'mm-key', MINIMAX_MODEL: 'MiniMax-M3' } }).kind).toBe('openrouter')
    expect(selectProvider({ env: { MINIMAX_API_KEY: 'mm-key' } }).kind).toBe('manual')
    expect(selectProvider({ env: {} }).kind).toBe('manual')
    expect(selectProvider({ env: { OPENROUTER_API_KEY: '  ', MINIMAX_API_KEY: 'mm-key' } }).kind).toBe('manual')
  })

  it('is Manual with no AI configured, whatever the Keeply login', () => {
    expect(selectProvider({ env: {}, authorisation: null }).kind).toBe('manual')
  })

  it('ignores keys for providers that are not built yet', () => {
    expect(selectProvider({ env: { OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y', MINIMAX_API_KEY: 'mm' } }).kind).toBe('manual')
  })

  it('picks the first available and falls past a failing provider', () => {
    expect(selectProvider({ env: {} }, [fake('chatgpt_authorized', 'throws'), fake('openrouter', true), fake('manual', true)]).kind).toBe('openrouter')
    expect(selectProvider({ env: {} }, [fake('openai_api', false)])).toBe(manualProvider)
  })

  it.each([
    [429, 'rate limited'],
    [402, 'payment required'],
    [500, 'upstream exploded'],
    [404, 'No endpoints available matching your guardrail restrictions and data policy'],
  ])('does not call another host when OpenRouter returns HTTP %s', async (status, detail) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: detail, key: 'or-test-key' }), { status }))
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'mm-key' },
      fetch: fetchMock as unknown as typeof fetch,
    })
    await expect(provider.identifyAppliance(photo)).rejects.toMatchObject({ name: 'OpenRouterError', status })
    const hosts = hostsOf(fetchMock)
    expect(hosts.every((host) => host === 'openrouter.ai')).toBe(true)
    expect(hosts).not.toContain('api.minimax.io')
    expect((await provider.identifyAppliance(photo).catch((error: Error) => error.message))).not.toContain(detail)
  })

  it('does not call another host when OpenRouter reports a provider error inside a 200 reply', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { code: 504, message: 'Provider timed out after 11748ms' } }))
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'mm-key' },
      fetch: fetchMock as unknown as typeof fetch,
    })
    await expect(provider.identifyAppliance(photo)).rejects.toMatchObject({ name: 'OpenRouterError', status: 504 })
    expect(hostsOf(fetchMock)).toEqual(['openrouter.ai'])
  })

  it('does not call another host when OpenRouter times out', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })
    })
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'mm-key' },
      fetch: fetchMock as unknown as typeof fetch,
    })
    await expect(provider.identifyAppliance(photo)).rejects.toThrow(/timed out/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(hostsOf(fetchMock)).toEqual(['openrouter.ai'])
  })

  it('keeps an empty OpenRouter reading and does not send it elsewhere', async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'no label here' } }] }))
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'mm-key' },
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(await provider.identifyAppliance(photo)).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('wires OpenRouter for label reading and manual reading, and keeps the appliance model out of the AI model field', async () => {
    const identity = '{"applianceType":"dishwasher","typeEvidence":"Dishwasher","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":null,"confidence":0.9}'
    const tasks = JSON.stringify({
      candidates: [{ task: 'Clean the filter', instructions: 'Rinse it.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Clean the filter every month.' }],
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const vision = String(init?.body).includes('image_url')
      return Response.json({ choices: [{ message: { content: vision ? identity : tasks } }] })
    })
    const provider = selectProvider({ env: { OPENROUTER_API_KEY: 'or-key' }, fetch: fetchMock as unknown as typeof fetch })
    expect(provider.kind).toBe('openrouter')
    expect(await provider.identifyAppliance(photo)).toMatchObject({ model: 'SMS6ZCI49E' })
    expect(await provider.extractTasks({ model: 'KEQB7300L', pages })).toEqual([
      { task: 'Clean the filter', instructions: 'Rinse it.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Clean the filter every month.' },
    ])
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(new URL(call[0]).hostname).toBe('openrouter.ai')
      const body = JSON.parse(call[1].body as string) as { model: string }
      expect(body.model).toBe('openrouter/free')
      expect(JSON.stringify(body)).not.toContain('KEQB7300L')
    }
  })

  it('returns "unavailable" for the Manual provider and any provider that has not implemented extraction yet', async () => {
    expect(await manualProvider.extractTasks({ model: 'm', pages: [] })).toBe('unavailable')
    const provider = selectProvider({ env: { MINIMAX_API_KEY: 'mm-key' } })
    expect(await provider.extractTasks({ model: 'm', pages })).toBe('unavailable')
  })
})
