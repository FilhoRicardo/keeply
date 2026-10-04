import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

function post(photo?: Blob, headers: Record<string, string> = {}) {
  const form = new FormData()
  if (photo) form.append('photo', photo, 'label.jpg')
  return POST(new NextRequest('http://keeply.local/api/identify', { method: 'POST', body: form, headers }))
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
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
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
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await (await post(new Blob(['x'], { type: 'image/jpeg' }))).json()).toEqual({ identification: null, notice: null })
    expect(errors).toHaveBeenCalled()
  })
})

describe('POST /api/identify for invited testers (default access mode)', () => {
  const MINIMAX_REPLY = '{"applianceType":"dishwasher","manufacturer":"BUSH","model":"WV9-6S","serialNumber":"150804092","confidence":0.95}'
  const photo = () => new Blob(['x'], { type: 'image/jpeg' })
  const session = { authorization: 'Bearer user-session-token' }

  // Supabase answers reserve_scan with `reservation`; MiniMax answers with a reading.
  function services(reservation: string | 'error') {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input)
        calls.push(url)
        if (url.includes('/rest/v1/rpc/reserve_scan')) {
          return reservation === 'error' ? new Response('{"message":"boom"}', { status: 500 }) : Response.json(reservation)
        }
        if (url.includes('minimax')) return Response.json({ choices: [{ message: { content: MINIMAX_REPLY } }] })
        throw new Error(`unexpected ${url}`)
      }),
    )
    return { minimaxCalls: () => calls.filter((u) => u.includes('minimax')).length, rpcCalls: () => calls.filter((u) => u.includes('reserve_scan')).length }
  }

  function configure() {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('MINIMAX_API_KEY', 'server-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.example')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  }

  it('calls MiniMax only after a scan is reserved', async () => {
    configure()
    const counts = services('allowed')
    const response = await post(photo(), session)
    expect(response.status).toBe(200)
    expect((await response.json()).identification).toMatchObject({ manufacturer: 'BUSH', model: 'WV9-6S' })
    expect([counts.rpcCalls(), counts.minimaxCalls()]).toEqual([1, 1])
  })

  it.each(['no_invite', 'tester_limit', 'daily_limit', 'signed_out'])('refuses %s without calling MiniMax', async (reason) => {
    configure()
    const counts = services(reason)
    const response = await post(photo(), session)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'scan_denied', reason })
    expect(counts.minimaxCalls()).toBe(0)
  })

  it('fails closed without a session, without Supabase, or when the reservation errors', async () => {
    configure()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let counts = services('allowed')
    expect(await (await post(photo())).json()).toEqual({ error: 'scan_denied', reason: 'unavailable' })
    expect(counts.rpcCalls() + counts.minimaxCalls()).toBe(0)

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect((await post(photo(), session)).status).toBe(403)
    expect(counts.minimaxCalls()).toBe(0)

    configure()
    counts = services('error')
    expect(await (await post(photo(), session)).json()).toEqual({ error: 'scan_denied', reason: 'unavailable' })
    expect(counts.minimaxCalls()).toBe(0)
    expect(errors).toHaveBeenCalled()
  })

  it('ignores KEEPLY_SCAN_ACCESS=open in Vercel Production', async () => {
    configure()
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubEnv('VERCEL_ENV', 'production')
    const counts = services('no_invite')
    expect((await post(photo(), session)).status).toBe(403)
    expect([counts.rpcCalls(), counts.minimaxCalls()]).toEqual([1, 0])
  })

  it('reserves nothing for an invalid photo or in Manual mode', async () => {
    configure()
    const counts = services('allowed')
    expect((await post(new Blob(['x'], { type: 'application/pdf' }), session)).status).toBe(400)
    vi.stubEnv('MINIMAX_API_KEY', '')
    expect((await post(photo(), session)).status).toBe(200)
    expect(counts.rpcCalls() + counts.minimaxCalls()).toBe(0)
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
