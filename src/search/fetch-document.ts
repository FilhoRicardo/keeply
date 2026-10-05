import 'server-only'
import { request as httpsRequest } from 'node:https'
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { isBlockedAddress } from './ip'

export type DocType = 'pdf' | 'html'

export type FetchFailure =
  | 'too_large'
  | 'blocked_address'
  | 'unsupported_type'
  | 'timeout'
  | 'invalid_url'
  | 'too_many_redirects'
  | 'fetch_failed'

export type FetchResult =
  | { ok: true; bytes: Uint8Array; type: DocType; url: string }
  | { ok: false; reason: FetchFailure }

// Init threaded into the `fetch` dependency. Tests inject their own `fetch` and provide
// `pinnedAddresses` by mirroring the same shape; the production default uses it to pin DNS.
export interface FetchInit {
  headers: Record<string, string>
  redirect: 'manual'
  credentials: 'omit'
  signal: AbortSignal
  pinnedAddresses: string[]
}

export interface FetchDeps {
  resolve(host: string): Promise<string[]>
  fetch(url: string, init: FetchInit): Promise<Response>
}

export interface FetchOptions {
  maxBytes?: number
  timeoutMs?: number
}

const MAX_REDIRECTS = 3
const USER_AGENT = 'Keeply/0.1 (manual lookup; +https://keeply.app)'

const defaultDeps: FetchDeps = {
  resolve: async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address),
  fetch: (url, init) => pinnedHttpsFetch(url, init),
}

class Stop extends Error {
  constructor(readonly reason: FetchFailure) {
    super(reason)
  }
}

// Resolve `host` and refuse every returned value that is not a public unicast address.
// Literal IP literals are checked without DNS. The returned list is the set the live
// connection will be pinned to, so subsequent DNS answers cannot influence the target.
async function resolvePublic(host: URL, deps: FetchDeps): Promise<string[]> {
  const hostname = host.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [hostname] : await deps.resolve(hostname)
  if (addresses.length === 0 || addresses.some(isBlockedAddress)) throw new Stop('blocked_address')
  return addresses
}

// Look up the address family for a single IP literal (Node's `lookup` callback wants one).
function addressFamily(ip: string): 4 | 6 {
  return ip.includes(':') ? 6 : 4
}

// Pin every TCP connect for this request to the first address from the validated set. Node's
// `https.request` still uses the hostname for SNI and the Host header (set explicitly below),
// but the actual socket goes to the pinned IP — defeating DNS rebinding that returns a public
// IP at validation time and a private one at connect time.
export function pinnedLookup(pinned: string[]) {
  return (
    _host: string,
    opts: { all?: boolean },
    cb: (err: Error | null, address: string | { address: string; family: number }[], family?: number) => void,
  ) => {
    const [address] = pinned
    const family = addressFamily(address)
    // Node 20+ asks for every address (`all: true`) and rejects a single-address answer.
    if (opts?.all) cb(null, [{ address, family }])
    else cb(null, address, family)
  }
}

// Read the Node IncomingMessage into a `Buffer` while enforcing the byte cap. We do the cap here
// (rather than the outer `readCapped`) so the production default fetch can hand a complete
// `Response` to the rest of the file unchanged.
async function pinnedHttpsFetch(rawUrl: string, init: FetchInit): Promise<Response> {
  const url = new URL(rawUrl)
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  return new Promise<Response>((resolveP, rejectP) => {
    const req = httpsRequest(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept: 'application/pdf,text/html',
          host: url.host,
          ...init.headers,
        },
        lookup: pinnedLookup(init.pinnedAddresses),
        // SNI: still the hostname so the certificate chain validates.
        servername: hostname,
        signal: init.signal,
      },
      (res) => {
        const declared = Number(res.headers['content-length'])
        if (Number.isFinite(declared) && declared > Number.MAX_SAFE_INTEGER) {
          // unreachable in practice; guard against absurd headers.
          res.resume()
          rejectP(new Stop('too_large'))
          return
        }
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
        })
        res.on('end', () => {
          const headers = new Headers()
          for (const [k, v] of Object.entries(res.headers)) {
            if (Array.isArray(v)) v.forEach((x) => headers.append(k, x))
            else if (v !== undefined) headers.set(k, String(v))
          }
          resolveP(new Response(Buffer.concat(chunks), { status: res.statusCode ?? 0, headers }))
        })
        res.on('error', rejectP)
      },
    )
    req.on('error', rejectP)
    req.end()
  })
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

// Fetches a manual over https. Failures are values. Every hop (including redirects) resolves
// only to public addresses, and the live connection is pinned to one of those validated
// addresses so a DNS-rebinding second answer cannot reach a private or loopback target.
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
      const pinned = await resolvePublic(url, deps)
      const res = await deps.fetch(url.href, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/pdf,text/html' },
        redirect: 'manual',
        credentials: 'omit',
        signal: controller.signal,
        pinnedAddresses: pinned,
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