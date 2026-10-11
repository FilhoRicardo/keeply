import { describe, expect, it, vi } from 'vitest'
import { extractTasksWithMiniMax, identifyWithMiniMax, MiniMaxError, minimaxConfig } from './minimax'
import type { ExtractedPage } from './extraction'

const config = { apiKey: 'test-key', model: 'MiniMax-M3', baseUrl: 'https://api.minimax.io/v1' }
const photo = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mimeType: 'image/jpeg' }

function reply(content: unknown, extra: Record<string, unknown> = {}) {
  return vi.fn(async () => Response.json({ choices: [{ message: { content } }], ...extra }))
}

describe('minimaxConfig', () => {
  it('needs a key and a model with image input', () => {
    expect(minimaxConfig({})).toBeNull()
    expect(minimaxConfig({ MINIMAX_API_KEY: 'k' })).toEqual({ apiKey: 'k', model: 'MiniMax-M3', baseUrl: 'https://api.minimax.io/v1' })
    expect(minimaxConfig({ MINIMAX_API_KEY: 'k', MINIMAX_MODEL: 'MiniMax-M2.7' })).toBeNull()
    expect(minimaxConfig({ MINIMAX_API_KEY: 'k', MINIMAX_BASE_URL: 'https://api.minimaxi.com/v1/' })?.baseUrl).toBe('https://api.minimaxi.com/v1')
  })
})

describe('identifyWithMiniMax', () => {
  it('sends the photo as an image_url data URI with thinking off, and returns Keeply’s schema', async () => {
    const fetchMock = reply(
      '<think>The label shows Bosch…</think>```json\n{"applianceType":"dishwasher","typeEvidence":"Dishwasher","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":"FD 9912","confidence":0.86}\n```',
    )
    const identity = await identifyWithMiniMax(config, photo, fetchMock as unknown as typeof fetch)

    expect(identity).toEqual({ applianceType: 'dishwasher', manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: 'FD 9912', confidence: 0.86 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.minimax.io/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'MiniMax-M3', thinking: { type: 'disabled' }, reasoning_split: true })
    expect(body.provider).toBeUndefined()
    expect(init.headers).not.toHaveProperty('HTTP-Referer')
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2Q==', detail: 'high' } })
  })

  it('keeps unreadable fields null and clamps confidence', async () => {
    const identity = await identifyWithMiniMax(config, photo, reply('{"applianceType":"Dishwasher","typeEvidence":"Dishwasher","manufacturer":"Miele","model":"","serialNumber":null,"confidence":7}') as unknown as typeof fetch)
    expect(identity).toEqual({ applianceType: 'dishwasher', manufacturer: 'Miele', model: null, serialNumber: null, confidence: 1 })
  })

  it('returns null for replies without usable JSON', async () => {
    expect(await identifyWithMiniMax(config, photo, reply('I cannot read this label.') as unknown as typeof fetch)).toBeNull()
    expect(await identifyWithMiniMax(config, photo, reply(null) as unknown as typeof fetch)).toBeNull()
  })

  it('reports HTTP and in-body MiniMax errors', async () => {
    const http = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(identifyWithMiniMax(config, photo, http as unknown as typeof fetch)).rejects.toBeInstanceOf(MiniMaxError)
    const inBody = reply(null, { base_resp: { status_code: 1004, status_msg: 'authentication failed' } })
    await expect(identifyWithMiniMax(config, photo, inBody as unknown as typeof fetch)).rejects.toThrow(/1004/)
  })

  it('does not send unsupported or oversized images', async () => {
    const fetchMock = reply('{}')
    expect(await identifyWithMiniMax(config, { bytes: new Uint8Array(1), mimeType: 'image/heic' }, fetchMock as unknown as typeof fetch)).toBeNull()
    expect(await identifyWithMiniMax(config, { bytes: new Uint8Array(10_000_001), mimeType: 'image/jpeg' }, fetchMock as unknown as typeof fetch)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('extractTasksWithMiniMax', () => {
  const P1 = 'Care and cleaning. Remove the dishwasher filter every month under running water.'
  const P2 = 'Run a cleaning cycle every three months to keep the interior fresh.'
  const pages: ExtractedPage[] = [
    { page: 1, text: P1 },
    { page: 2, text: P2 },
  ]

  it('sends the page text as a single user message with thinking off, and returns cleaned candidates', async () => {
    const body = {
      candidates: [
        { task: 'Clean the filter', instructions: 'Twist out, rinse, refit.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Remove the dishwasher filter every month under running water.' },
        { task: 'Run a cleaning cycle', instructions: 'Hottest cycle, dishwasher cleaner.', interval: { count: 3, unit: 'month' }, page: 2, quote: 'Run a cleaning cycle every three months to keep the interior fresh.' },
      ],
    }
    const fetchMock = reply(JSON.stringify(body))
    const result = await extractTasksWithMiniMax(config, pages, fetchMock as unknown as typeof fetch)
    expect(result).toEqual([
      { task: 'Clean the filter', instructions: 'Twist out, rinse, refit.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Remove the dishwasher filter every month under running water.' },
      { task: 'Run a cleaning cycle', instructions: 'Hottest cycle, dishwasher cleaner.', interval: { count: 3, unit: 'month' }, page: 2, quote: 'Run a cleaning cycle every three months to keep the interior fresh.' },
    ])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.minimax.io/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    const req = JSON.parse(init.body as string)
    expect(req).toMatchObject({ model: 'MiniMax-M3', thinking: { type: 'disabled' }, reasoning_split: true, temperature: 0.1 })
    expect(req.messages[0].content).toContain('JSON object')
    expect(req.messages[1].content).toContain('[Page 1]')
    expect(req.messages[1].content).toContain(P1)
    expect(req.messages[1].content).toContain('[Page 2]')
    expect(req.messages[1].content).toContain(P2)
  })

  it('does not call the model when no pages are provided', async () => {
    const fetchMock = vi.fn()
    expect(await extractTasksWithMiniMax(config, [], fetchMock as unknown as typeof fetch)).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('strips a <think> tag the model left behind before parsing', async () => {
    const body = { candidates: [{ task: 'Clean the filter', instructions: 'Rinse and refit.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Remove the dishwasher filter every month under running water.' }] }
    const fetchMock = reply(`<think>The manual says…</think>${JSON.stringify(body)}`)
    const result = await extractTasksWithMiniMax(config, pages, fetchMock as unknown as typeof fetch)
    expect(result).toHaveLength(1)
    expect(result[0]?.task).toBe('Clean the filter')
  })

  it('drops a candidate pointing at a page that was not sent (hallucinated page), keeps the rest', async () => {
    const body = {
      candidates: [
        { task: 'Real one', instructions: 'ok', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Remove the dishwasher filter every month under running water.' },
        { task: 'Hallucinated', instructions: 'fake', interval: { count: 1, unit: 'month' }, page: 99, quote: 'Some invented quote not on any page.' },
      ],
    }
    const result = await extractTasksWithMiniMax(config, pages, reply(JSON.stringify(body)) as unknown as typeof fetch)
    expect(result).toHaveLength(1)
    expect(result[0]?.task).toBe('Real one')
  })

  it('returns the candidates as-is when the model invents a quote not in the page text (the quote is verified later by P3-1, not here)', async () => {
    const body = {
      candidates: [{ task: 'With fake quote', instructions: 'do thing', interval: { count: 1, unit: 'month' }, page: 1, quote: 'A completely invented sentence that is not on page one at all.' }],
    }
    const result = await extractTasksWithMiniMax(config, pages, reply(JSON.stringify(body)) as unknown as typeof fetch)
    expect(result).toEqual([{ task: 'With fake quote', instructions: 'do thing', interval: { count: 1, unit: 'month' }, page: 1, quote: 'A completely invented sentence that is not on page one at all.' }])
  })

  it('returns an empty list and does not throw on malformed JSON, an empty list, or non-array candidates', async () => {
    expect(await extractTasksWithMiniMax(config, pages, reply('I cannot read this.') as unknown as typeof fetch)).toEqual([])
    expect(await extractTasksWithMiniMax(config, pages, reply('{"candidates": []}') as unknown as typeof fetch)).toEqual([])
    expect(await extractTasksWithMiniMax(config, pages, reply(null) as unknown as typeof fetch)).toEqual([])
    expect(await extractTasksWithMiniMax(config, pages, reply('not even json {') as unknown as typeof fetch)).toEqual([])
  })

  it('drops a malformed candidate but keeps the good ones from the same reply', async () => {
    const body = {
      candidates: [
        { task: 'Good', instructions: 'ok', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Remove the dishwasher filter every month under running water.' },
        { task: '', instructions: 'no name', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Remove the dishwasher filter every month under running water.' },
        { task: 'Bad interval', instructions: 'ok', interval: { count: 0, unit: 'month' }, page: 1, quote: 'Remove the dishwasher filter every month under running water.' },
        null,
        'not an object',
      ],
    }
    const result = await extractTasksWithMiniMax(config, pages, reply(JSON.stringify(body)) as unknown as typeof fetch)
    expect(result).toHaveLength(1)
    expect(result[0]?.task).toBe('Good')
  })

  it('reports HTTP and in-body MiniMax errors', async () => {
    const http = vi.fn(async () => new Response('{}', { status: 401 }))
    await expect(extractTasksWithMiniMax(config, pages, http as unknown as typeof fetch)).rejects.toBeInstanceOf(MiniMaxError)
    const inBody = reply(null, { base_resp: { status_code: 1004, status_msg: 'authentication failed' } })
    await expect(extractTasksWithMiniMax(config, pages, inBody as unknown as typeof fetch)).rejects.toThrow(/1004/)
  })

  it('surfaces a network or timeout error from fetch (so the caller can fall back to general guidance)', async () => {
    // AbortSignal.timeout(60_000) fires after a minute; the adapter does not catch, the caller
    // does. We assert the contract by throwing synchronously from fetch: the adapter lets it
    // bubble up so a future route can `.catch(() => generalGuidance)`.
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    await expect(extractTasksWithMiniMax(config, pages, fetchMock as unknown as typeof fetch)).rejects.toBeInstanceOf(TypeError)
  })
})
