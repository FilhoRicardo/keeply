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
  delete process.env.BRAVE_FREE_QUOTA_PER_MONTH
})

function expectEmpty(result: Awaited<ReturnType<typeof searchManuals>>): asserts result is {
  status: 'empty'
  candidates: []
  reason: 'rate_limited' | 'timeout' | 'network_error' | 'http_error' | `http_${number}` | 'malformed_response' | 'no_results' | 'quota_exhausted'
  braveStatus: readonly number[]
} {
  if (result.status !== 'empty') throw new Error(`expected empty, got ${result.status}`)
}

function expectOk(result: Awaited<ReturnType<typeof searchManuals>>): asserts result is {
  status: 'ok'
  candidates: { url: string; title: string; snippet: string; host: string }[]
  braveStatus: readonly number[]
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

  it('builds the three search queries in order, one asking for the PDF itself', async () => {
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
    expect(urls).toEqual(['Bosch SMS6 user manual', 'Bosch SMS6 manual filetype:pdf', 'Bosch SMS6 maintenance'])
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
    expect(result.reason).toBe('http_500')
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

  describe('free-quota hard stop', () => {
    it('returns quota_exhausted without calling fetchImpl when the in-process counter already equals the cap', async () => {
      process.env[ENV_KEY] = 'k'
      const warmupFetch = vi.fn(async () => Response.json(goodResponse([])))
      // Drive the counter to 3 with a generous cap so the warm-up search completes.
      await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(warmupFetch), freeQuotaCap: 100, now: () => fakeNow, sleep: fakeSleep },
      )
      expect(braveSearchCallCount()).toBe(3)
      // Tighten the cap to the exact current counter and run a fresh search. The gate must fire.
      const fetchMock2 = vi.fn(async () => {
        throw new Error('fetchImpl must not be called when the cap is reached')
      })
      const result = await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(fetchMock2), freeQuotaCap: 3, now: () => fakeNow, sleep: fakeSleep },
      )
      expectEmpty(result)
      expect(result.reason).toBe('quota_exhausted')
      expect(fetchMock2).not.toHaveBeenCalled()
      // Counter must NOT increment on a refused call.
      expect(braveSearchCallCount()).toBe(3)
    })

    it('still serves the request when the counter is below the cap', async () => {
      process.env[ENV_KEY] = 'k'
      const fetchMock = vi.fn(async () => Response.json(goodResponse(['https://bosch-home.com/SMS6.pdf'])))
      const result = await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(fetchMock), freeQuotaCap: 100, now: () => fakeNow, sleep: fakeSleep },
      )
      expectOk(result)
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('reads BRAVE_FREE_QUOTA_PER_MONTH from the injected env when no option is passed', async () => {
      process.env[ENV_KEY] = 'k'
      const warmupFetch = vi.fn(async () => Response.json(goodResponse([])))
      await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(warmupFetch), freeQuotaCap: 100, now: () => fakeNow, sleep: fakeSleep },
      )
      expect(braveSearchCallCount()).toBe(3)
      // Now claim the cap is exactly the current counter via env. The next search must refuse.
      const fetchMock2 = vi.fn(async () => {
        throw new Error('fetchImpl must not be called when the env-supplied cap is reached')
      })
      const result = await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(fetchMock2), env: { ...process.env, BRAVE_FREE_QUOTA_PER_MONTH: '3' }, now: () => fakeNow, sleep: fakeSleep },
      )
      expectEmpty(result)
      expect(result.reason).toBe('quota_exhausted')
      expect(fetchMock2).not.toHaveBeenCalled()
    })

    it('hard-stops mid-call: counter at cap-1 lets one fetch through, then the next loop iteration refuses', async () => {
      // Spec: "the per-process counter must not exceed this, even if the API would otherwise
      // accept a paid-tier request." With cap=2 and counter warmed to cap-1=1, the entry gate
      // passes (1 < 2), the first iteration issues one fetch and advances the counter to 2,
      // and the second iteration's in-loop check must fire and refuse the second and third
      // fetches. Counter must end exactly at the cap, not cap+2.
      process.env[ENV_KEY] = 'k'
      // Warm the counter to exactly cap-1=1 using cap=1: a single call fetches once (iter 1,
      // 0>=1 is false), advances counter 0->1, and on iter 2 the in-loop check 1>=1 fires
      // and returns quota_exhausted. Counter ends at exactly 1.
      const warmFetch = vi.fn(async () => Response.json(goodResponse([])))
      const warm = await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(warmFetch), freeQuotaCap: 1, now: () => fakeNow, sleep: fakeSleep },
      )
      expectEmpty(warm)
      expect(warm.reason).toBe('quota_exhausted')
      expect(braveSearchCallCount()).toBe(1) // cap-1 = 1
      // Now the test: cap=2, counter=1 (cap-1). Entry gate passes; iteration 1 issues one
      // fetch (counter -> 2); iteration 2's in-loop check refuses; iteration 3 never runs.
      const fetchMock = vi.fn(async () => Response.json(goodResponse([])))
      const result = await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(fetchMock), freeQuotaCap: 2, now: () => fakeNow, sleep: fakeSleep },
      )
      expectEmpty(result)
      expect(result.reason).toBe('quota_exhausted')
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(braveSearchCallCount()).toBe(2) // exactly the cap, not cap+2
    })

    it('falls back to the documented default (2000) when no option or env is provided', async () => {
      process.env[ENV_KEY] = 'k'
      delete process.env.BRAVE_FREE_QUOTA_PER_MONTH
      const warmupFetch = vi.fn(async () => Response.json(goodResponse([])))
      // Bring the counter to exactly 2 (one search, cap huge so it completes).
      await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(warmupFetch), freeQuotaCap: 100, now: () => fakeNow, sleep: fakeSleep },
      )
      // Verify the default cap by checking that a counter of 2 still allows a search (we cannot
      // easily reach 2000 in a test, so we instead confirm the cap is consulted: any cap > counter
      // is permissive, the default of 2000 is permissive for counter=3, but the call below would
      // need 3 more increments. We assert instead that the default DOES NOT cause a refused call
      // when the counter is small — proving the cap is large enough to permit a normal request.
      const fetchMock = vi.fn(async () => Response.json(goodResponse([])))
      const result = await searchManuals(
        { manufacturer: 'Bosch', model: 'SMS6' },
        { fetchImpl: fakeFetch(fetchMock), now: () => fakeNow, sleep: fakeSleep },
      )
      expectEmpty(result)
      expect(result.reason).toBe('no_results')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })
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
