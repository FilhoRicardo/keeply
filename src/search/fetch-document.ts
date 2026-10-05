import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isBlockedAddress } from './ip'

export type DocType = 'pdf' | 'html'
export type FetchFailure = 'too_large' | 'blocked_address' | 'unsupported_type' | 'timeout' | 'invalid_url' | 'too_many_redirects' | 'fetch_failed'
export type FetchResult = { ok: true; bytes: Uint8Array; type: DocType; url: string } | { ok: false; reason: FetchFailure }

export interface FetchDeps {
  resolve(host: string): Promise<string[]>
  fetch(url: string, init: { headers: Record<string, string>; redirect: 'manual'; credentials: 'omit'; signal: AbortSignal }): Promise<Response>
}

export interface FetchOptions {
  maxBytes?: number
  timeoutMs?: number
}

const MAX_REDIRECTS = 3
const defaultDeps: FetchDeps = {
  resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
  fetch: (url, init) => fetch(url, init),
}

class Stop extends Error {
  constructor(readonly reason: FetchFailure) {
    super(reason)
  }
}

async function assertPublicHost(url: URL, deps: FetchDeps): Promise<void> {
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(host) ? [host] : await deps.resolve(host)
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) throw new Stop('blocked_address')
}

function docType(header: string | null): DocType | null {
  const t = (header ?? '').split(';')[0].trim().toLowerCase()
  return t === 'application/pdf' ? 'pdf' : t === 'text/html' ? 'html' : null
}

async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Stop('too_large')
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new Stop('too_large')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}

// Fetches a manual over https. Failures are values. Every hop (including redirects) must
// resolve only to public addresses. Note: the address is validated, then fetch resolves
// again; a DNS-rebinding race is narrowed by the short time limit but not closed.
export async function fetchDocument(rawUrl: string, deps: FetchDeps = defaultDeps, opts: FetchOptions = {}): Promise<FetchResult> {
  const maxBytes = opts.maxBytes ?? 15 * 1024 * 1024
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000)
  try {
    let url: URL
    try {
      url = new URL(rawUrl)
    } catch {
      return { ok: false, reason: 'invalid_url' }
    }
    for (let hop = 0; ; hop++) {
      if (url.protocol !== 'https:') throw new Stop('invalid_url')
      if (url.username || url.password) throw new Stop('blocked_address')
      await assertPublicHost(url, deps)
      const res = await deps.fetch(url.href, {
        headers: { 'user-agent': 'Keeply/0.1 (manual lookup; +https://keeply.app)', accept: 'application/pdf,text/html' },
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
      })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel()
        if (!location) throw new Stop('fetch_failed')
        if (hop >= MAX_REDIRECTS) throw new Stop('too_many_redirects')
        try {
          url = new URL(location, url)
        } catch {
          throw new Stop('invalid_url')
        }
        continue
      }
      if (!res.ok) throw new Stop('fetch_failed')
      const type = docType(res.headers.get('content-type'))
      if (!type) {
        await res.body?.cancel()
        throw new Stop('unsupported_type')
      }
      return { ok: true, bytes: await readCapped(res, maxBytes), type, url: url.href }
    }
  } catch (e) {
    if (e instanceof Stop) return { ok: false, reason: e.reason }
    if (controller.signal.aborted) return { ok: false, reason: 'timeout' }
    return { ok: false, reason: 'fetch_failed' }
  } finally {
    clearTimeout(timer)
  }
}
