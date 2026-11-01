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
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
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
    vi.stubEnv('OPENROUTER_API_KEY', '')
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ identification: null, notice: null })
  })

  it('turns an OpenRouter reading into a proposal for the confirm screen', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        expect(String(input)).toBe('https://openrouter.ai/api/v1/chat/completions')
        return Response.json({
          choices: [{ message: { content: '{"applianceType":"unknown","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":null,"confidence":0.8}' } }],
        })
      }),
    )
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(await response.json()).toEqual({
      identification: { category: 'unknown', manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '', confidence: 0.8, source: 'photo_recognition' },
      notice: null,
    })
  })

  it('accepts a fridge label and proposes it (no dishwasher rejection, KEE-60)', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '{"applianceType":"fridge","typeEvidence":"fridge","manufacturer":"LG","model":"LRFXS2503S","serialNumber":null,"confidence":0.7}' } }],
        }),
      ),
    )
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(await response.json()).toEqual({
      identification: { category: 'fridge', manufacturer: 'LG', model: 'LRFXS2503S', serialNumber: '', confidence: 0.7, source: 'photo_recognition' },
      notice: null,
    })
  })

  it('ignores a leftover MiniMax key and uses OpenRouter only', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('MINIMAX_API_KEY', 'leftover-mm')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    const hosts: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        hosts.push(new URL(String(input)).hostname)
        return Response.json({
          choices: [{ message: { content: '{"applianceType":"dishwasher","typeEvidence":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.9}' } }],
        })
      }),
    )
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(await response.json()).toEqual({
      identification: {
        category: 'dishwasher',
        manufacturer: 'Electrolux',
        model: 'KEQB7300L',
        serialNumber: '',
        confidence: 0.9,
        source: 'photo_recognition',
      },
      notice: null,
    })
    expect(hosts).toEqual(['openrouter.ai'])
  })

  it('says label reading is unavailable when the provider errors, and hides the error body', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"invalid key sk-secret-fragment"}', { status: 500 })))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain('sk-secret-fragment')
    expect(JSON.parse(text)).toEqual({ identification: null, notice: 'ai_unavailable' })
    expect(errors).not.toHaveBeenCalled()
    expect(JSON.parse(String(logs.mock.calls[0]?.[0]))).toMatchObject({
      event: 'identify',
      httpStatus: 500,
      retried: false,
      parseableJson: false,
      manufacturerFound: false,
    })
  })

  it('logs one structured line per call and reports OpenRouter model id on success', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          model: 'google/gemma-3-27b-it:free',
          choices: [{ message: { content: '{"applianceType":"dishwasher","typeEvidence":"dishwasher","manufacturer":"Electrolux","model":"KEQB7300L","serialNumber":null,"confidence":0.9}' } }],
        }),
      ),
    )
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(JSON.parse(String(logs.mock.calls[0]?.[0]))).toMatchObject({
      event: 'identify',
      httpStatus: 200,
      retried: false,
      parseableJson: true,
      manufacturerFound: true,
      reportedModel: 'google/gemma-3-27b-it:free',
      latencyMs: expect.any(Number),
    })
  })

  it('returns ai_limit when OpenRouter is rate limited after one retry', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"error":"slow down","key":"or-key"}', { status: 429 })),
    )
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(await response.json()).toEqual({ identification: null, notice: 'ai_limit' })
    expect(JSON.parse(String(logs.mock.calls[0]?.[0]))).toMatchObject({
      event: 'identify',
      httpStatus: 429,
      retried: true,
      parseableJson: false,
      manufacturerFound: false,
    })
  })

  it('returns ai_limit when OpenRouter reports payment required', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"payment"}', { status: 402 })))
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(await response.json()).toEqual({ identification: null, notice: 'ai_limit' })
  })

  it('says label reading is unavailable when the provider times out, and hides the error text', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('The operation timed out sk-secret-fragment')
      }),
    )
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    const text = await response.text()
    expect(response.status).toBe(200)
    expect(text).not.toContain('sk-secret-fragment')
    expect(JSON.parse(text)).toEqual({ identification: null, notice: 'ai_unavailable' })
    expect(errors).not.toHaveBeenCalled()
    expect(JSON.parse(String(logs.mock.calls[0]?.[0]))).toMatchObject({ event: 'identify', httpStatus: 'timeout' })
  })

  it('still proposes nothing when the provider answers that it recognised nothing', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: '{"applianceType":"unknown","manufacturer":null,"model":null,"serialNumber":null,"confidence":0}' } }],
        }),
      ),
    )
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ identification: null, notice: null })
  })
})

describe('POST /api/identify for invited testers (default access mode)', () => {
  const OPENROUTER_REPLY =
    '{"applianceType":"dishwasher","typeEvidence":"dishwasher","manufacturer":"BUSH","model":"WV9-6S","serialNumber":"150804092","confidence":0.95}'
  const photo = () => new Blob(['x'], { type: 'image/jpeg' })
  const session = { authorization: 'Bearer user-session-token' }
  const anonymousUser = {
    id: '11111111-1111-4111-8111-111111111111',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.test',
    is_anonymous: true,
  }

  // Supabase answers reserve_scan with `reservation`; OpenRouter answers with a reading.
  function services(reservation: string | 'error') {
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input)
        calls.push(url)
        if (url.includes('/auth/v1/user')) return Response.json(anonymousUser)
        if (url.includes('/rest/v1/rpc/reserve_scan')) {
          return reservation === 'error' ? new Response('{"message":"boom"}', { status: 500 }) : Response.json(reservation)
        }
        if (url.includes('openrouter.ai')) return Response.json({ choices: [{ message: { content: OPENROUTER_REPLY } }] })
        throw new Error(`unexpected ${url}`)
      }),
    )
    return {
      openrouterCalls: () => calls.filter((u) => u.includes('openrouter.ai')).length,
      rpcCalls: () => calls.filter((u) => u.includes('reserve_scan')).length,
      all: () => calls,
    }
  }

  function configure() {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    vi.stubEnv('KEEPLY_SCAN_ACCESS', '')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.example')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  }

  it('calls OpenRouter only after a scan is reserved', async () => {
    configure()
    const counts = services('allowed')
    const response = await post(photo(), session)
    expect(response.status).toBe(200)
    expect((await response.json()).identification).toMatchObject({ manufacturer: 'BUSH', model: 'WV9-6S' })
    expect([counts.rpcCalls(), counts.openrouterCalls()]).toEqual([1, 1])
  })

  it.each(['no_invite', 'tester_limit', 'daily_limit', 'signed_out'])('refuses %s without calling OpenRouter', async (reason) => {
    configure()
    const counts = services(reason)
    const response = await post(photo(), session)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'scan_denied', reason })
    expect(counts.openrouterCalls()).toBe(0)
  })

  it('counts a failed OpenRouter attempt and says label reading is unavailable', async () => {
    configure()
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input instanceof Request ? input.url : input)
        calls.push(url)
        if (url.includes('/auth/v1/user')) return Response.json(anonymousUser)
        if (url.includes('/rest/v1/rpc/reserve_scan')) return Response.json('allowed')
        if (url.includes('openrouter.ai')) {
          expect(new Headers(init?.headers).get('authorization')).toBe('Bearer or-key')
          return new Response('{"error":"slow down","key":"or-key"}', { status: 429 })
        }
        throw new Error(`unexpected ${url}`)
      }),
    )
    const response = await post(photo(), session)
    const text = await response.text()
    expect(text).not.toContain('or-key')
    expect(JSON.parse(text)).toEqual({ identification: null, notice: 'ai_limit' })
    const reserveAt = calls.findIndex((url) => url.includes('reserve_scan'))
    const aiAt = calls.findIndex((url) => url.includes('openrouter.ai'))
    expect(reserveAt).toBeGreaterThanOrEqual(0)
    expect(aiAt).toBeGreaterThan(reserveAt)
  })

  it('fails closed without a session, without Supabase, or when the reservation errors', async () => {
    configure()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    let counts = services('allowed')
    expect(await (await post(photo())).json()).toEqual({ error: 'scan_denied', reason: 'unavailable' })
    expect(counts.rpcCalls() + counts.openrouterCalls()).toBe(0)

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '')
    expect((await post(photo(), session)).status).toBe(403)
    expect(counts.openrouterCalls()).toBe(0)

    configure()
    counts = services('error')
    expect(await (await post(photo(), session)).json()).toEqual({ error: 'scan_denied', reason: 'unavailable' })
    expect(counts.openrouterCalls()).toBe(0)
    expect(errors).toHaveBeenCalled()
  })

  it('ignores KEEPLY_SCAN_ACCESS=open in Vercel Production', async () => {
    configure()
    vi.stubEnv('KEEPLY_SCAN_ACCESS', 'open')
    vi.stubEnv('VERCEL_ENV', 'production')
    const counts = services('no_invite')
    expect((await post(photo(), session)).status).toBe(403)
    expect([counts.rpcCalls(), counts.openrouterCalls()]).toEqual([1, 0])
  })

  it('reserves nothing for an invalid photo or in Manual mode', async () => {
    configure()
    const counts = services('allowed')
    expect((await post(new Blob(['x'], { type: 'application/pdf' }), session)).status).toBe(400)
    vi.stubEnv('OPENROUTER_API_KEY', '')
    expect((await post(photo(), session)).status).toBe(200)
    expect(counts.rpcCalls() + counts.openrouterCalls()).toBe(0)
  })
})

describe('wellFormed', () => {
  it('drops proposals a recogniser could plausibly return malformed', async () => {
    const { wellFormed } = await import('./route')
    const good = { category: 'dishwasher', manufacturer: 'Bosch', model: '', serialNumber: '', confidence: 0.7, source: 'photo_recognition' }
    expect(wellFormed(good)).toBe(true)
    expect(wellFormed({ ...good, category: 'fridge' })).toBe(true)
    expect(wellFormed({ ...good, manufacturer: undefined })).toBe(false)
    expect(wellFormed({ ...good, confidence: '0.7' })).toBe(false)
    expect(wellFormed({ ...good, source: 'manual' })).toBe(false)
    expect(wellFormed(null)).toBe(false)
  })
})

describe('toProposal', () => {
  it('accepts any appliance type from the model (no more dishwasher rejection, KEE-60)', async () => {
    const { toProposal } = await import('./route')
    expect(toProposal({ applianceType: 'fridge', manufacturer: 'LG', model: 'LRFXS2503S', serialNumber: null, confidence: 0.7 })).toEqual({
      identification: { category: 'fridge', manufacturer: 'LG', model: 'LRFXS2503S', serialNumber: '', confidence: 0.7, source: 'photo_recognition' },
      notice: null,
    })
  })

  it('drops a reading without a manufacturer', async () => {
    const { toProposal } = await import('./route')
    expect(toProposal({ applianceType: 'dishwasher', manufacturer: null, model: 'X', serialNumber: null, confidence: 0.2 }).identification).toBeNull()
  })
})
