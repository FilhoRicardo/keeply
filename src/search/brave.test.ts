import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  braveSearchCallCount,
  resetBraveSearchCallCount,
  searchManuals,
} from './brave'

const ENV_KEY = 'BRAVE_SEARCH_API_KEY'

const goodResponse = (urls: string[]) => ({
  web: {
    results: urls.map((url) => ({
      url,
      title: `${new URL(url).host} manual`,
      description: 'snippet',
    })),
  },
})

beforeEach(() => {
  resetBraveSearchCallCount()
  fakeNow = 0
  fakeSleepCalls.length = 0
})

afterEach(() => {
  delete process.env[ENV_KEY]
})

function expectEmpty(result: Awaited<ReturnType<typeof searchManuals>>): asserts result is {
  status: 'empty'
  candidates: []
  reason: 'rate_limited' | 'timeout' | 'network_error' | 'http_error' | 'malformed_response' | 'no_results'
} {
  if (result.status !== 'empty') throw new Error(`expected empty, got ${result.status}`)
}

function expectOk(result: Awaited<ReturnType<typeof searchManuals>>): asserts result is {
  status: 'ok'
  candidates: { url: string; title: string; snippet: string; host: string }[]
} {
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`)
}

describe('searchManuals', () => {
  it('returns unavailable when the API key is missing', async () => {
    const result = await searchManuals({ manufacturer: 'Bosch', model: 'SMS6' }, { fetchImpl: fakeFetch() })
    expect(result).toEqual({ status: 'unavailable' })
    expect(braveSearchCallCount()).toBe(0)
  })

  it('counts every outbound attempt even when the call is rate-limited', async () => {
    process.env[ENV_KEY] = 'test-key'
    const calls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input))
      return new Response('{}', { status: 429, headers: { 'Retry-After': '1' } })
    })
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectEmpty(result)
    expect(result.reason).toBe('rate_limited')
    // 3 sequential queries, all attempted.
    expect(braveSearchCallCount()).toBe(3)
    expect(calls).toHaveLength(3)
  })

  it('counts zero when the key is missing, and one per outbound call when present', async () => {
    // No key first: zero calls.
    let r = await searchManuals({ manufacturer: 'Bosch', model: 'SMS6' }, { fetchImpl: fakeFetch() })
    expect(r).toEqual({ status: 'unavailable' })
    expect(braveSearchCallCount()).toBe(0)

    // With key, three queries are issued: three counts.
    process.env[ENV_KEY] = 'test-key'
    const fetchMock = vi.fn(async () => Response.json(goodResponse(['https://bosch-home.com/manual.pdf'])))
    r = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectOk(r)
    expect(braveSearchCallCount()).toBe(3)
  })

  it('paces calls so the second does not fire before 1s after the first', async () => {
    process.env[ENV_KEY] = 'test-key'
    const fetchMock = vi.fn(async () => Response.json(goodResponse([])))
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectEmpty(result)
    expect(result.reason).toBe('no_results')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fakeSleepCalls).toEqual([1000, 1000])
  })

  it('honours Retry-After as the pacing window for the next call', async () => {
    process.env[ENV_KEY] = 'test-key'
    const fetchMock = vi.fn(async () => new Response('{}', { status: 429, headers: { 'Retry-After': '2' } }))
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectEmpty(result)
    expect(result.reason).toBe('rate_limited')
    // All three queries are attempted; between them we sleep according to Retry-After
    // (max 2s, enforced as the 1s minimum floor).
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fakeSleepCalls.length).toBe(2)
    for (const ms of fakeSleepCalls) expect(ms).toBeGreaterThanOrEqual(1000)
  })

  it('sends the key in the X-Subscription-Token header, never in the URL or the body', async () => {
    process.env[ENV_KEY] = 'super-secret-key'
    const fetchMock = vi.fn(async () => Response.json(goodResponse([])))
    await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as unknown as [string, RequestInit]
      expect(url).not.toContain('super-secret-key')
      // The body must not contain the key. Headers are allowed and required.
      const body = init.body
      if (body != null) expect(typeof body === 'string' ? body : JSON.stringify(body)).not.toContain('super-secret-key')
      const headers = new Headers(init.headers)
      expect(headers.get('X-Subscription-Token')).toBe('super-secret-key')
    }
  })

  it('builds the three search queries in order', async () => {
    process.env[ENV_KEY] = 'k'
    const urls: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = new URL(String(input))
      urls.push(u.searchParams.get('q') ?? '')
      return Response.json(goodResponse([]))
    })
    await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expect(urls).toEqual(['Bosch SMS6 user manual', 'Bosch SMS6 instruction manual', 'Bosch SMS6 maintenance'])
  })

  it('stops on rate-limit but keeps earlier results', async () => {
    process.env[ENV_KEY] = 'k'
    const responses: Response[] = [
      Response.json(goodResponse(['https://bosch-home.com/SMS6.pdf'])),
      Response.json(goodResponse(['https://bosch-home.com/SMS6-handbuch.pdf'])),
      new Response('{}', { status: 429, headers: { 'Retry-After': '1' } }),
    ]
    const fetchMock = vi.fn(async () => responses.shift()!.clone())
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectOk(result)
    expect(result.candidates.map((c) => c.url)).toEqual([
      'https://bosch-home.com/SMS6-handbuch.pdf',
      'https://bosch-home.com/SMS6.pdf',
    ])
  })

  it('returns malformed_response when the body has no web.results array', async () => {
    process.env[ENV_KEY] = 'k'
    const responses: Response[] = [
      Response.json({ web: null }),
      Response.json({ web: { results: null } }),
      Response.json({}),
    ]
    const fetchMock = vi.fn(async () => responses.shift()!.clone())
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectEmpty(result)
    expect(result.reason).toBe('malformed_response')
  })

  it('returns no_results when the body is well-formed but empty', async () => {
    process.env[ENV_KEY] = 'k'
    const fetchMock = vi.fn(async () => Response.json({ web: { results: [] } }))
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectEmpty(result)
    expect(result.reason).toBe('no_results')
  })

  it('returns http_error for non-2xx non-429 responses', async () => {
    process.env[ENV_KEY] = 'k'
    const fetchMock = vi.fn(async () => new Response('{}', { status: 500 }))
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectEmpty(result)
    expect(result.reason).toBe('http_error')
  })

  it('returns network_error when fetch throws (e.g. timeout)', async () => {
    process.env[ENV_KEY] = 'k'
    const fetchMock = vi.fn(async () => {
      throw new Error('boom')
    })
    const result = await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
    )
    expectEmpty(result)
    expect(result.reason).toBe('network_error')
  })

  it('uses the optional abortSignal from options to bound the call', async () => {
    process.env[ENV_KEY] = 'k'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Response.json(goodResponse([]))
    })
    await searchManuals(
      { manufacturer: 'Bosch', model: 'SMS6' },
      { fetchImpl: fakeFetch(fetchMock), abortSignal: AbortSignal.timeout(5000), now: () => fakeNow, sleep: fakeSleep },
    )
    expect(fetchMock).toHaveBeenCalled()
  })

  it('never throws even with a hostile fetch', async () => {
    process.env[ENV_KEY] = 'k'
    const fetchMock = vi.fn(async () => {
      throw new TypeError('unreachable')
    })
    await expect(
      searchManuals({ manufacturer: 'Bosch', model: 'SMS6' }, { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep }),
    ).resolves.toBeDefined()
  })
})

// fakeNow is mutable; tests push it forward to avoid relying on real timers.
let fakeNow = 0
const fakeSleepCalls: number[] = []
function fakeSleep(ms: number) {
  fakeSleepCalls.push(ms)
  fakeNow += ms
  return Promise.resolve()
}

type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function fakeFetch(mock?: FetchMock): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!mock) throw new Error('network in test')
    return mock(input, init)
  }) as typeof fetch
}
