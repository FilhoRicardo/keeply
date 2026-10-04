import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

function post(photo?: Blob) {
  const form = new FormData()
  if (photo) form.append('photo', photo, 'label.jpg')
  return POST(new NextRequest('http://keeply.local/api/identify', { method: 'POST', body: form }))
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('POST /api/identify', () => {
  it('is off unless scanning is enabled, even with a provider key, and calls nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '')
    vi.stubEnv('MINIMAX_API_KEY', 'server-key')
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    expect((await post(new Blob(['x'], { type: 'image/jpeg' }))).status).toBe(404)
    expect(fetchSpy).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('validates the photo', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    expect((await post()).status).toBe(400)
    expect((await post(new Blob(['x'], { type: 'application/pdf' }))).status).toBe(400)
    expect((await post(new Blob([new Uint8Array(4_000_001)], { type: 'image/jpeg' }))).status).toBe(400)
  })

  it('proposes nothing in Manual mode', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('MINIMAX_API_KEY', '')
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ identification: null, notice: null })
  })

  it('turns a MiniMax reading into a proposal for the confirm screen', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('MINIMAX_API_KEY', 'server-key')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ choices: [{ message: { content: '{"applianceType":"unknown","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":null,"confidence":0.8}' } }] }),
      ),
    )
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(await response.json()).toEqual({
      identification: { category: 'dishwasher', manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '', confidence: 0.8, source: 'photo_recognition' },
      notice: null,
    })
  })

  it('falls back to Manual when MiniMax fails', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('MINIMAX_API_KEY', 'server-key')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await (await post(new Blob(['x'], { type: 'image/jpeg' }))).json()).toEqual({ identification: null, notice: null })
    expect(errors).toHaveBeenCalled()
  })
})

describe('wellFormed', () => {
  it('drops proposals a recogniser could plausibly return malformed', async () => {
    const { wellFormed } = await import('./route')
    const good = { category: 'dishwasher', manufacturer: 'Bosch', model: '', serialNumber: '', confidence: 0.7, source: 'photo_recognition' }
    expect(wellFormed(good)).toBe(true)
    expect(wellFormed({ ...good, manufacturer: undefined })).toBe(false)
    expect(wellFormed({ ...good, confidence: '0.7' })).toBe(false)
    expect(wellFormed({ ...good, source: 'manual' })).toBe(false)
    expect(wellFormed(null)).toBe(false)
  })
})

describe('toProposal', () => {
  it('says when the label is not a dishwasher', async () => {
    const { toProposal } = await import('./route')
    expect(toProposal({ applianceType: 'other', manufacturer: 'Bosch', model: 'WAX32', serialNumber: null, confidence: 0.9 })).toEqual({
      identification: null,
      notice: 'not_a_dishwasher',
    })
  })

  it('drops a reading without a manufacturer', async () => {
    const { toProposal } = await import('./route')
    expect(toProposal({ applianceType: 'dishwasher', manufacturer: null, model: 'X', serialNumber: null, confidence: 0.2 }).identification).toBeNull()
  })
})
