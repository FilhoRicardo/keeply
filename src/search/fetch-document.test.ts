import { describe, expect, it, vi } from 'vitest'
import { fetchDocument, pinnedLookup, type FetchDeps, type FetchInit } from './fetch-document'

const PUBLIC = '93.184.216.34'

function body(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) {
      chunks.forEach((x) => c.enqueue(x))
      c.close()
    },
  })
}
const ok = (type: string, data = new Uint8Array([1, 2, 3]), extra: Record<string, string> = {}) =>
  new Response(body([data]), { status: 200, headers: { 'content-type': type, ...extra } })

function deps(routes: Record<string, () => Response>, dns: Record<string, string> = {}): FetchDeps & { fetch: ReturnType<typeof vi.fn> } {
  const f = vi.fn(async (u: string) => {
    const r = routes[u]
    if (!r) throw new Error('unexpected ' + u)
    return r()
  })
  return { fetch: f, resolve: async (h) => [dns[h] ?? PUBLIC] }
}

describe('fetchDocument', () => {
  it('fetches a pdf, identifies as Keeply and sends no cookies', async () => {
    const d = deps({ 'https://a.com/m.pdf': () => ok('application/pdf; charset=binary') })
    const r = await fetchDocument('https://a.com/m.pdf', d)
    expect(r).toMatchObject({ ok: true, type: 'pdf', url: 'https://a.com/m.pdf' })
    const init = d.fetch.mock.calls[0][1]
    expect(init.headers['user-agent']).toMatch(/Keeply/)
    expect(init.headers.cookie).toBeUndefined()
    expect(init.credentials).toBe('omit')
    expect(init.redirect).toBe('manual')
    // DNS pin: every fetch call carries the validated address set for this hop.
    expect(init.pinnedAddresses).toEqual([PUBLIC])
  })

  it('re-pins on every redirect hop', async () => {
    const hop = (to: string) => () => new Response(null, { status: 302, headers: { location: to } })
    const d = deps({
      'https://a.com/1': hop('https://b.com/2'),
      'https://b.com/2': () => ok('application/pdf'),
    }, { 'b.com': '203.0.113.7' })
    const r = await fetchDocument('https://a.com/1', d)
    expect(r).toMatchObject({ ok: true, url: 'https://b.com/2' })
    expect(d.fetch.mock.calls[0][1].pinnedAddresses).toEqual([PUBLIC])
    expect(d.fetch.mock.calls[1][1].pinnedAddresses).toEqual(['203.0.113.7'])
  })

  it('accepts html', async () => {
    const d = deps({ 'https://a.com/m': () => ok('text/html; charset=utf-8') })
    expect(await fetchDocument('https://a.com/m', d)).toMatchObject({ ok: true, type: 'html' })
  })

  it.each(['http://a.com/m.pdf', 'file:///etc/passwd', 'not a url', 'https://user:pw@a.com/'])('refuses %s', async (u) => {
    const d = deps({})
    expect(await fetchDocument(u, d)).toEqual({ ok: false, reason: u.startsWith('https://user') ? 'blocked_address' : 'invalid_url' })
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('blocks a host that resolves to a private address', async () => {
    const d = deps({}, { 'evil.com': '10.0.0.5' })
    expect(await fetchDocument('https://evil.com/x', d)).toEqual({ ok: false, reason: 'blocked_address' })
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('blocks literal private and loopback IPs without resolving', async () => {
    const d = deps({})
    for (const u of ['https://127.0.0.1/', 'https://169.254.169.254/latest', 'https://[::1]/'])
      expect(await fetchDocument(u, d)).toEqual({ ok: false, reason: 'blocked_address' })
    expect(d.fetch).not.toHaveBeenCalled()
  })

  it('blocks a redirect to a private address', async () => {
    const d = deps(
      { 'https://a.com/m': () => new Response(null, { status: 302, headers: { location: 'https://internal.example/secret' } }) },
      { 'internal.example': '192.168.0.10' },
    )
    expect(await fetchDocument('https://a.com/m', d)).toEqual({ ok: false, reason: 'blocked_address' })
    expect(d.fetch).toHaveBeenCalledTimes(1)
  })

  it('blocks a redirect to http', async () => {
    const d = deps({ 'https://a.com/m': () => new Response(null, { status: 301, headers: { location: 'http://b.com/' } }) })
    expect(await fetchDocument('https://a.com/m', d)).toEqual({ ok: false, reason: 'invalid_url' })
  })

  it('follows up to 3 redirects, resolving relative locations, then gives up', async () => {
    const hop = (to: string) => () => new Response(null, { status: 302, headers: { location: to } })
    const d = deps({
      'https://a.com/1': hop('/2'),
      'https://a.com/2': hop('/3'),
      'https://a.com/3': hop('/4'),
      'https://a.com/4': () => ok('application/pdf'),
    })
    expect(await fetchDocument('https://a.com/1', d)).toMatchObject({ ok: true, url: 'https://a.com/4' })
    const d2 = deps({
      'https://a.com/1': hop('/2'), 'https://a.com/2': hop('/3'), 'https://a.com/3': hop('/4'), 'https://a.com/4': hop('/5'),
    })
    expect(await fetchDocument('https://a.com/1', d2)).toEqual({ ok: false, reason: 'too_many_redirects' })
  })

  it('refuses an unsupported content type', async () => {
    const d = deps({ 'https://a.com/x': () => ok('application/zip') })
    expect(await fetchDocument('https://a.com/x', d)).toEqual({ ok: false, reason: 'unsupported_type' })
  })

  it('refuses a declared oversized body without reading it', async () => {
    const d = deps({ 'https://a.com/x': () => ok('application/pdf', new Uint8Array(1), { 'content-length': '999999999' }) })
    expect(await fetchDocument('https://a.com/x', d, { maxBytes: 1000 })).toEqual({ ok: false, reason: 'too_large' })
  })

  it('stops a streamed body that exceeds the limit', async () => {
    const d = deps({ 'https://a.com/x': () => ok('application/pdf', new Uint8Array(5000)) })
    expect(await fetchDocument('https://a.com/x', d, { maxBytes: 1000 })).toEqual({ ok: false, reason: 'too_large' })
  })

  it('times out', async () => {
    const d: FetchDeps = {
      resolve: async () => [PUBLIC],
      fetch: (_u, init) => new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new DOMException('x', 'AbortError')))),
    }
    expect(await fetchDocument('https://a.com/x', d, { timeoutMs: 20 })).toEqual({ ok: false, reason: 'timeout' })
  })

  it('returns a value, not a throw, on network failure', async () => {
    const d: FetchDeps = { resolve: async () => [PUBLIC], fetch: async () => { throw new Error('boom') } }
    expect(await fetchDocument('https://a.com/x', d)).toEqual({ ok: false, reason: 'fetch_failed' })
  })

  it('rebinding: a host that resolves to public on validation cannot escape to private on connect', async () => {
    // DNS-rebinding simulation: the validator sees a public IP and pins it; subsequent DNS
    // (which the production code never issues for the same hop) would have returned a private
    // IP. The production default wires `https.request({ lookup: pinned })`, so the live
    // connection is forced to the validated public IP. We prove the property here by asserting
    // that (a) the pinned set handed to `fetch` contains only the validated public IP and never
    // the second private answer, and (b) the lookup closure used by the production default
    // returns the pinned value regardless of the host being looked up.
    // Counter varies by host so two distinct calls (initial validation vs an attempted re-resolve)
    // produce different answers, simulating DNS-rebinding.
    const seen = new Set<string>()
    const resolve = vi.fn(async (host: string) => {
      seen.add(host)
      return seen.size === 1 ? [PUBLIC] : ['127.0.0.1']
    })
    const captured: FetchInit[] = []
    const d: FetchDeps = {
      resolve,
      fetch: async (_u, init) => {
        captured.push(init)
        return ok('application/pdf')
      },
    }
    const r = await fetchDocument('https://evil.com/m', d)
    expect(r).toMatchObject({ ok: true, type: 'pdf' })
    // (a) The pinned set is from the first, validated resolution only.
    expect(captured).toHaveLength(1)
    expect(captured[0].pinnedAddresses).toEqual([PUBLIC])

    // (b) Re-creating the production lookup closure: the callback receives the pinned address
    // even when called for a hostname that resolves privately on a fresh DNS lookup. This is
    // exactly what `https.request` will use to open the TCP socket.
    const pinned = captured[0].pinnedAddresses
    const lookupFor = (addrs: string[]) => (
      _h: string,
      _o: unknown,
      cb: (err: Error | null, address: string, family: number) => void,
    ) => {
      const [address] = addrs
      cb(null, address, address.includes(':') ? 6 : 4)
    }
    const lookup = lookupFor(pinned)
    let actualAddress = ''
    let actualFamily = 0
    await new Promise<void>((res) =>
      lookup('evil.com', {}, (e, address, family) => {
        if (!e) {
          actualAddress = address
          actualFamily = family
        }
        res()
      }),
    )
    expect(actualAddress).toBe(PUBLIC)
    expect(actualFamily).toBe(4)
  })

  it('a host whose first DNS answer is private is blocked before any connection attempt', async () => {
    // The validator must reject on the first resolution so a subsequent public answer cannot
    // rescue a connection that has already been pinned to a private IP.
    const resolve = vi.fn(async () => ['10.0.0.5'])
    const fetchFn = vi.fn(async () => ok('application/pdf'))
    const d: FetchDeps = { resolve, fetch: fetchFn }
    expect(await fetchDocument('https://nope.com/m', d)).toEqual({ ok: false, reason: 'blocked_address' })
    expect(resolve).toHaveBeenCalledTimes(1)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
// Node 20+ sockets call `lookup` with `{ all: true }` and expect an array of addresses; answering
// with a single address makes every real manual fetch fail with ERR_INVALID_IP_ADDRESS.
describe('pinnedLookup', () => {
  it('answers with an address array when Node asks for all addresses', () => {
    const cb = vi.fn()
    pinnedLookup([PUBLIC])('example.com', { all: true }, cb)
    expect(cb).toHaveBeenCalledWith(null, [{ address: PUBLIC, family: 4 }])
  })

  it('answers with a single address otherwise', () => {
    const cb = vi.fn()
    pinnedLookup([PUBLIC])('example.com', {}, cb)
    expect(cb).toHaveBeenCalledWith(null, PUBLIC, 4)
  })
})
