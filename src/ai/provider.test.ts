import { describe, expect, it, vi } from 'vitest'
import { CANDIDATES, manualProvider, selectProvider, type AiCandidate } from './provider'

function hostsCalled(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map((call) => new URL(String((call as unknown[])[0])).hostname)
}

const fake = (kind: AiCandidate['kind'], available: boolean | 'throws'): AiCandidate => ({
  kind,
  available: () => {
    if (available === 'throws') throw new Error('misconfigured')
    return available
  },
  create: () => ({ kind, identifyAppliance: async () => null, extractTasks: async () => 'unavailable' }),
})

describe('selectProvider', () => {
  it('keeps the documented order with Manual last', () => {
    expect(CANDIDATES.map((c) => c.kind)).toEqual([
      'chatgpt_authorized',
      'openrouter',
      'openai_api',
      'anthropic_api',
      'keeply_hosted',
      'manual',
    ])
  })

  it('prefers OpenRouter when configured, otherwise Manual', () => {
    expect(selectProvider({ env: { OPENROUTER_API_KEY: 'or-key' } }).kind).toBe('openrouter')
    expect(selectProvider({ env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'ignored' } }).kind).toBe('openrouter')
    expect(selectProvider({ env: {} }).kind).toBe('manual')
    expect(selectProvider({ env: { OPENROUTER_API_KEY: '  ', MINIMAX_API_KEY: 'leftover' } }).kind).toBe('manual')
  })

  it('is Manual with no AI configured, whatever the Keeply login', () => {
    expect(selectProvider({ env: {}, authorisation: null }).kind).toBe('manual')
  })

  it('ignores a leftover MiniMax key and other providers that are not built yet', () => {
    expect(selectProvider({ env: { MINIMAX_API_KEY: 'k', MINIMAX_MODEL: 'MiniMax-M3' } }).kind).toBe('manual')
    expect(selectProvider({ env: { OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' } }).kind).toBe('manual')
  })

  it('picks the first available and falls past a failing provider', () => {
    expect(selectProvider({ env: {} }, [fake('chatgpt_authorized', 'throws'), fake('openrouter', true), fake('manual', true)]).kind).toBe(
      'openrouter',
    )
    expect(selectProvider({ env: {} }, [fake('openai_api', false)])).toBe(manualProvider)
  })

  it('surfaces OpenRouter HTTP refusals without falling back to another AI provider', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"rate limited"}', { status: 429 }))
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'leftover-mm' },
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(provider.kind).toBe('openrouter')
    await expect(provider.identifyAppliance({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' })).rejects.toThrow(
      /OpenRouter rejected the request \(429\)/,
    )
    expect(hostsCalled(fetchMock)).toEqual(['openrouter.ai', 'openrouter.ai'])
  })

  it('surfaces an OpenRouter provider error inside a 200 reply without calling another AI host', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { code: 504, message: 'Provider timed out after 11748ms' } }))
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'leftover-mm' },
      fetch: fetchMock as unknown as typeof fetch,
    })
    await expect(provider.identifyAppliance({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' })).rejects.toThrow(/OpenRouter/)
    expect(hostsCalled(fetchMock)).toEqual(['openrouter.ai'])
  })

  it('does not retry elsewhere when OpenRouter answers with nothing read', async () => {
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: 'no label here' } }] }))
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key' },
      fetch: fetchMock as unknown as typeof fetch,
    })
    expect(await provider.identifyAppliance({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' })).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never retries a timeout on another host', async () => {
    const timingOut = vi.fn(async () => {
      throw Object.assign(new Error('The operation timed out.'), { name: 'TimeoutError' })
    })
    const provider = selectProvider({
      env: { OPENROUTER_API_KEY: 'or-key' },
      fetch: timingOut as unknown as typeof fetch,
    })
    await expect(provider.identifyAppliance({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' })).rejects.toThrow(/timed out/)
    expect(timingOut).toHaveBeenCalledTimes(1)
  })

  it('wires OpenRouter identify and extractTasks through the same provider', async () => {
    const identity =
      '{"applianceType":"dishwasher","typeEvidence":"Dishwasher","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":null,"confidence":0.9}'
    const tasks = JSON.stringify({
      candidates: [{ task: 'Clean the filter', instructions: 'Rinse it.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Clean the filter every month.' }],
    })
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const vision = String(init?.body).includes('image_url')
      return Response.json({ choices: [{ message: { content: vision ? identity : tasks } }] })
    })
    const provider = selectProvider({ env: { OPENROUTER_API_KEY: 'or-key' }, fetch: fetchMock as unknown as typeof fetch })
    expect(provider.kind).toBe('openrouter')
    expect(await provider.identifyAppliance({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' })).toMatchObject({ model: 'SMS6ZCI49E' })
    expect(await provider.extractTasks({ model: 'SMS6ZCI49E', pages: [{ page: 1, text: 'Clean the filter every month.' }] })).toEqual([
      { task: 'Clean the filter', instructions: 'Rinse it.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Clean the filter every month.' },
    ])
  })

  it('keeps the appliance model out of the AI model field', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({
                candidates: [
                  {
                    task: 'Clean the filter',
                    instructions: 'Rinse it.',
                    interval: { count: 1, unit: 'month' },
                    page: 4,
                    quote: 'Clean the filter every month.',
                  },
                ],
              }),
            },
          },
        ],
      }),
    )
    const provider = selectProvider({ env: { OPENROUTER_API_KEY: 'or-key' }, fetch: fetchMock as unknown as typeof fetch })
    const result = await provider.extractTasks({
      model: 'KEQB7300L',
      pages: [{ page: 4, text: 'Clean the filter every month.' }],
    })
    expect(result).toEqual([
      {
        task: 'Clean the filter',
        instructions: 'Rinse it.',
        interval: { count: 1, unit: 'month' },
        page: 4,
        quote: 'Clean the filter every month.',
      },
    ])
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { model: string }
    expect(body.model).toBe('openrouter/free')
    expect(JSON.stringify(body)).not.toContain('KEQB7300L')
  })

  it('returns "unavailable" for the Manual provider and any provider that has not implemented extraction yet', async () => {
    expect(await manualProvider.extractTasks({ model: 'm', pages: [] })).toBe('unavailable')
    const provider = selectProvider({ env: {} })
    expect(await provider.extractTasks({ model: 'm', pages: [] })).toBe('unavailable')
  })
})
