import { describe, expect, it, vi } from 'vitest'
import { identifyWithMiniMax, MiniMaxError, minimaxConfig } from './minimax'

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
      '<think>The label shows Bosch…</think>```json\n{"applianceType":"dishwasher","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":"FD 9912","confidence":0.86}\n```',
    )
    const identity = await identifyWithMiniMax(config, photo, fetchMock as unknown as typeof fetch)

    expect(identity).toEqual({ applianceType: 'dishwasher', manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: 'FD 9912', confidence: 0.86 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.minimax.io/v1/chat/completions')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({ model: 'MiniMax-M3', thinking: { type: 'disabled' }, reasoning_split: true })
    expect(body.messages[1].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,/9j/2Q==', detail: 'high' } })
  })

  it('keeps unreadable fields null and clamps confidence', async () => {
    const identity = await identifyWithMiniMax(config, photo, reply('{"applianceType":"Dishwasher","manufacturer":"Miele","model":"","serialNumber":null,"confidence":7}') as unknown as typeof fetch)
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
