import { describe, expect, it, vi } from 'vitest'
import { fetchDocument, type FetchDeps } from './fetch-document'

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
})
