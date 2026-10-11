import { describe, expect, it, vi } from 'vitest'
import type { ExtractedPage } from './extraction'
import { extractTasksWithOpenRouter, identifyWithOpenRouter, OpenRouterError, openrouterConfig, type OpenRouterConfig } from './openrouter'

const config: OpenRouterConfig = {
  apiKey: 'or-test-key',
  model: 'openrouter/free',
  baseUrl: 'https://openrouter.ai/api/v1',
  dataCollection: 'deny',
}
const photo = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' }

function reply(content: unknown, extra: Record<string, unknown> = {}) {
  return vi.fn(async () => Response.json({ choices: [{ message: { content, ...extra } }] }))
}

function requestOf(fetchMock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
  return { url, init, body: JSON.parse(init.body as string) as Record<string, unknown> }
}

describe('openrouterConfig', () => {
  it('needs a key, defaults the free vision model, and denies data collection unless allow is set', () => {
    expect(openrouterConfig({})).toBeNull()
    expect(openrouterConfig({ OPENROUTER_API_KEY: '  ' })).toBeNull()
    expect(openrouterConfig({ OPENROUTER_API_KEY: 'k' })).toEqual({
      apiKey: 'k',
      model: 'openrouter/free',
      baseUrl: 'https://openrouter.ai/api/v1',
      dataCollection: 'deny',
    })
    expect(openrouterConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'google/gemma-4-26b-a4b-it:free' })?.model).toBe('google/gemma-4-26b-a4b-it:free')
    expect(openrouterConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_DATA_COLLECTION: 'allow' })?.dataCollection).toBe('allow')
    expect(openrouterConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_DATA_COLLECTION: 'Deny' })?.dataCollection).toBe('deny')
    expect(openrouterConfig({ OPENROUTER_API_KEY: 'k', OPENROUTER_DATA_COLLECTION: 'yes' })?.dataCollection).toBe('deny')
  })
})

describe('identifyWithOpenRouter', () => {
  it('sends the model, the image part, data_collection deny, and the attribution headers', async () => {
    const fetchMock = reply(
      '<think>The label shows Electrolux…</think><reasoning>draft</reasoning>{"applianceType":"dishwasher","typeEvidence":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.91}',
    )
    const identity = await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch)

    expect(identity).toEqual({
      applianceType: 'dishwasher',
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
      serialNumber: null,
      confidence: 0.91,
    })
    const { url, init, body } = requestOf(fetchMock)
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer or-test-key',
      'HTTP-Referer': 'https://keeply.vercel.app',
      'X-Title': 'Keeply',
    })
    expect(body.model).toBe('openrouter/free')
    expect(body.provider).toEqual({ data_collection: 'deny' })
    expect(body.reasoning).toEqual({ enabled: false })
    expect(body).not.toHaveProperty('thinking')
    const messages = body.messages as { content: { type: string; image_url?: { url: string; detail: string } }[] }[]
    expect(messages[1]?.content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2Q==', detail: 'high' } })
  })

  it('sends allow only when the config opts in', async () => {
    const fetchMock = reply('{"applianceType":"dishwasher","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":null,"confidence":0.5}')
    await identifyWithOpenRouter({ ...config, dataCollection: 'allow', model: 'google/gemma-4-26b-a4b-it:free' }, photo, fetchMock as unknown as typeof fetch)
    expect(requestOf(fetchMock).body).toMatchObject({
      model: 'google/gemma-4-26b-a4b-it:free',
      provider: { data_collection: 'allow' },
    })
  })

  it('parses a JSON reply and ignores a separate reasoning channel', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: '{"applianceType":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.8}',
              reasoning: '{"applianceType":"dishwasher","manufacturer":"Smeg","model":"DI6012-1","serialNumber":null,"confidence":0.99}',
            },
          },
        ],
      }),
    )
    const identity = await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch)
    expect(identity).toMatchObject({ manufacturer: 'Electrolux', model: 'KEQB7300L' })
  })

  it('does not treat reasoning as the answer when content is empty', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: '<think>only a draft</think>',
              reasoning: '{"applianceType":"dishwasher","manufacturer":"Smeg","model":"DI6012-1","serialNumber":null,"confidence":0.99}',
            },
          },
        ],
      }),
    )
    expect(await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch)).toBeNull()
  })

  it('ignores a reasoning content part and parses the text part', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: [
                { type: 'reasoning', text: '{"applianceType":"dishwasher","manufacturer":"Smeg","model":"DI6012-1","serialNumber":null,"confidence":0.99}' },
                { type: 'text', text: '{"applianceType":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.8}' },
              ],
            },
          },
        ],
      }),
    )
    expect(await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch)).toMatchObject({
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
    })
  })

  it('reads text parts when the reply content is an array', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: [{ type: 'text', text: '{"applianceType":"fridge","manufacturer":"LG","model":"LRFXS2503S","serialNumber":null,"confidence":0.7}' }],
            },
          },
        ],
      }),
    )
    expect(await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch)).toMatchObject({ manufacturer: 'LG', model: 'LRFXS2503S' })
  })

  it('reads output_text, a structured object, or a text part that puts the JSON in content', async () => {
    const parts = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: [
                {
                  type: 'text',
                  thought: true,
                  text: '{"applianceType":"dishwasher","manufacturer":"Smeg","model":"DI6012-1","serialNumber":null,"confidence":0.99}',
                },
                {
                  type: 'output_text',
                  text: '{"applianceType":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.8}',
                },
              ],
              reasoning_content: '{"applianceType":"dishwasher","manufacturer":"Smeg","model":"DI6012-1","serialNumber":null,"confidence":0.99}',
            },
          },
        ],
      }),
    )
    expect(await identifyWithOpenRouter(config, photo, parts as unknown as typeof fetch)).toMatchObject({
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
    })

    const objectReply = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: { applianceType: 'oven', manufacturer: 'Bosch', model: 'HBL8443', serialNumber: null, confidence: 0.6 },
            },
          },
        ],
      }),
    )
    expect(await identifyWithOpenRouter(config, photo, objectReply as unknown as typeof fetch)).toMatchObject({
      manufacturer: 'Bosch',
      model: 'HBL8443',
    })

    const contentField = vi.fn(async () =>
      Response.json({
        choices: [
          {
            message: {
              content: [{ type: 'text', content: '{"applianceType":"fridge","manufacturer":"LG","model":"LRFXS2503S","serialNumber":null,"confidence":0.7}' }],
            },
          },
        ],
      }),
    )
    expect(await identifyWithOpenRouter(config, photo, contentField as unknown as typeof fetch)).toMatchObject({
      manufacturer: 'LG',
      model: 'LRFXS2503S',
    })
  })

  it('keeps the last identity and does not let a nested draft replace it', async () => {
    const fetchMock = reply(
      '<thinking>draft</thinking>{"note":"looking"} {"applianceType":"dishwasher","manufacturer":"Smeg","model":"DI6012-1","serialNumber":null,"confidence":0.2} {"applianceType":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.9,"extra":{"model":"DI6012-1"}}',
    )
    expect(await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch)).toMatchObject({
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
    })
    const wrapped = reply('{"result":{"applianceType":"fridge","manufacturer":"LG","model":"LRFXS2503S","serialNumber":null,"confidence":0.7}}')
    expect(await identifyWithOpenRouter(config, photo, wrapped as unknown as typeof fetch)).toMatchObject({ manufacturer: 'LG', model: 'LRFXS2503S' })
    const note = reply('{"note":"no label"}')
    expect(await identifyWithOpenRouter(config, photo, note as unknown as typeof fetch)).toBeNull()
  })

  it.each([
    [402, 'payment required'],
    [500, 'upstream exploded'],
    [503, 'unavailable'],
  ])('maps HTTP %s to a provider failure without copying the body or the key', async (status, detail) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: detail, key: 'or-test-key', image: '/9j/2Q==' }), { status }))
    const error = await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OpenRouterError)
    expect(error).toMatchObject({ status })
    expect((error as Error).message).not.toContain('or-test-key')
    expect((error as Error).message).not.toContain(detail)
    expect((error as Error).message).not.toContain('/9j/')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 429 once on the same deadline and then reports the rate limit', async () => {
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      return new Response(JSON.stringify({ error: 'rate limit', key: 'or-test-key', image: '/9j/2Q==' }), { status: 429 })
    })
    const error = await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OpenRouterError)
    expect(error).toMatchObject({ status: 429 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(signals[0]).toBe(signals[1])
    expect((error as Error).message).not.toContain('or-test-key')
    expect((error as Error).message).not.toContain('rate limit')
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string) as { provider: unknown; model: string }
      expect(body.model).toBe('openrouter/free')
      expect(body.provider).toEqual({ data_collection: 'deny' })
    }
  })

  it('uses the identity from the single 429 retry', async () => {
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      if (signals.length === 1) return new Response('{"error":"rate limit"}', { status: 429 })
      return Response.json({
        choices: [
          {
            message: {
              content: '{"applianceType":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.91}',
            },
          },
        ],
      })
    })
    expect(await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch)).toMatchObject({
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
    })
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
    expect(signals[0]?.aborted).toBe(false)
  })

  it('maps a data_collection routing miss to a provider failure', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: { code: 404, message: 'No endpoints available matching your guardrail restrictions and data policy' },
        }),
        { status: 404 },
      ),
    )
    const error = await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OpenRouterError)
    expect(error).toMatchObject({ status: 404 })
    expect((error as Error).message).not.toContain('data policy')
    expect(requestOf(fetchMock).body.provider).toEqual({ data_collection: 'deny' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a timeout to a provider failure', async () => {
    const fetchMock = vi.fn(async () => {
      throw Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    })
    const error = await identifyWithOpenRouter(config, photo, fetchMock as unknown as typeof fetch).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(OpenRouterError)
    expect((error as OpenRouterError).status).toBeUndefined()
    expect((error as Error).message).toBe('OpenRouter timed out')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not send unsupported or oversized images', async () => {
    const fetchMock = reply('{}')
    expect(await identifyWithOpenRouter(config, { bytes: new Uint8Array(1), mimeType: 'image/heic' }, fetchMock as unknown as typeof fetch)).toBeNull()
    expect(await identifyWithOpenRouter(config, { bytes: new Uint8Array(10_000_001), mimeType: 'image/jpeg' }, fetchMock as unknown as typeof fetch)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('extractTasksWithOpenRouter', () => {
  const pages: ExtractedPage[] = [{ page: 12, text: 'Clean the filter every month under running water.' }]

  it('parses a JSON reply and strips a think block before reading candidates', async () => {
    const body = {
      candidates: [
        {
          task: 'Clean the filter',
          instructions: 'Rinse it.',
          interval: { count: 1, unit: 'month' },
          page: 12,
          quote: 'Clean the filter every month under running water.',
        },
      ],
    }
    const fetchMock = reply(`<think>page 12 mentions the filter</think>${JSON.stringify(body)}`)
    const result = await extractTasksWithOpenRouter(config, pages, fetchMock as unknown as typeof fetch)
    expect(result).toEqual([
      {
        task: 'Clean the filter',
        instructions: 'Rinse it.',
        interval: { count: 1, unit: 'month' },
        page: 12,
        quote: 'Clean the filter every month under running water.',
      },
    ])
    const { url, body: sent } = requestOf(fetchMock)
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(sent.model).toBe('openrouter/free')
    expect(sent.provider).toEqual({ data_collection: 'deny' })
    expect(sent.reasoning).toEqual({ enabled: false })
    expect(sent.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining('[Page 12]') })]),
    )
  })

  it('asks the configured model, not the appliance model passed by the caller', async () => {
    const fetchMock = reply('{"candidates":[]}')
    await extractTasksWithOpenRouter({ ...config, model: 'google/gemma-4-26b-a4b-it:free' }, pages, fetchMock as unknown as typeof fetch)
    expect(requestOf(fetchMock).body.model).toBe('google/gemma-4-26b-a4b-it:free')
  })

  it('reads the last candidates list, a wrapped list, or a bare array', async () => {
    const candidate = {
      task: 'Clean the filter',
      instructions: 'Rinse it.',
      interval: { count: 1, unit: 'month' },
      page: 12,
      quote: 'Clean the filter every month under running water.',
    }
    const earlier = { ...candidate, task: 'Ignore this draft', quote: 'Clean the filter every month under running water.' }
    const lastList = reply(`{"note":true} ${JSON.stringify({ candidates: [earlier] })} ${JSON.stringify({ candidates: [candidate] })}`)
    expect(await extractTasksWithOpenRouter(config, pages, lastList as unknown as typeof fetch)).toEqual([candidate])

    const wrapped = reply(JSON.stringify({ result: { candidates: [candidate] } }))
    expect(await extractTasksWithOpenRouter(config, pages, wrapped as unknown as typeof fetch)).toEqual([candidate])

    const bare = reply(JSON.stringify([candidate]))
    expect(await extractTasksWithOpenRouter(config, pages, bare as unknown as typeof fetch)).toEqual([candidate])
  })

  it('retries extraction once when the first response is 429', async () => {
    const signals: AbortSignal[] = []
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal)
      if (signals.length === 1) return new Response('{"error":"rate limit"}', { status: 429 })
      return Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] })
    })
    expect(await extractTasksWithOpenRouter(config, pages, fetchMock as unknown as typeof fetch)).toEqual([])
    expect(signals).toHaveLength(2)
    expect(signals[0]).toBe(signals[1])
    for (const call of fetchMock.mock.calls) {
      const body = JSON.parse((call[1] as RequestInit).body as string) as { provider: unknown }
      expect(body.provider).toEqual({ data_collection: 'deny' })
    }
  })

  it.each([402, 502])('maps extraction HTTP %s to a provider failure without a retry', async (status) => {
    const fetchMock = vi.fn(async () => new Response('{"error":"no"}', { status }))
    await expect(extractTasksWithOpenRouter(config, pages, fetchMock as unknown as typeof fetch)).rejects.toMatchObject({
      name: 'OpenRouterError',
      status,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('maps a repeated extraction 429 to a provider failure after one retry', async () => {
    const fetchMock = vi.fn(async () => new Response('{"error":"no"}', { status: 429 }))
    await expect(extractTasksWithOpenRouter(config, pages, fetchMock as unknown as typeof fetch)).rejects.toMatchObject({
      name: 'OpenRouterError',
      status: 429,
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('maps an extraction timeout to a provider failure', async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error('aborted')
      error.name = 'AbortError'
      throw error
    })
    await expect(extractTasksWithOpenRouter(config, pages, fetchMock as unknown as typeof fetch)).rejects.toMatchObject({
      name: 'OpenRouterError',
      message: 'OpenRouter timed out',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
