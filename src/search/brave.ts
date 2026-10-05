import 'server-only'
import { buildDefaultManufacturerDomains, hostOf, rankCandidates, type ManufacturerDomainMap, type RawCandidate, type RankedCandidate } from './rank'

// Brave Search client for Keeply's manual lookup. Server-only: the API key is never exposed
// to the browser, and the module throws at import time on the client because of `server-only`.
//
// Three queries are issued sequentially with a one-request-per-second floor (the Brave free
// tier is about 1 RPS). Every outbound attempt increments the in-process counter so the CFO
// view can read it; this resets per serverless instance. We stop on 429 and keep whatever the
// earlier queries returned, and we never throw — every failure mode degrades to an `empty`
// result with a typed reason.

const API_KEY_ENV = 'BRAVE_SEARCH_API_KEY'
const BRAVE_BASE_URL = 'https://api.search.brave.com/res/v1/web/search'
const MIN_GAP_MS = 1000
const DEFAULT_TIMEOUT_MS = 10_000
const DEFAULT_RESULTS_PER_QUERY = 10

const DEFAULT_MANUFACTURER_DOMAINS: ManufacturerDomainMap = buildDefaultManufacturerDomains()

export type SearchReason = 'rate_limited' | 'timeout' | 'network_error' | 'http_error' | 'malformed_response' | 'no_results'

export type SearchCandidate = {
  url: string
  title: string
  snippet: string
  host: string
}

export type SearchResult =
  | { status: 'ok'; candidates: SearchCandidate[] }
  | { status: 'empty'; candidates: []; reason: SearchReason }
  | { status: 'unavailable' }

export type BraveSearchCallOptions = {
  // Override the env-var key (mostly for tests).
  env?: Record<string, string | undefined>
  // Override the fetch implementation (mostly for tests).
  fetchImpl?: typeof fetch
  // Optional AbortSignal passed through to each call.
  abortSignal?: AbortSignal
  // Injectable clock; defaults to Date.now.
  now?: () => number
  // Injectable sleep; defaults to setTimeout. Resolves once the gap has elapsed.
  sleep?: (ms: number) => Promise<void>
  // Optional override of the manufacturer domain map (mostly for tests).
  manufacturerDomains?: ManufacturerDomainMap
  // Optional per-query timeout in ms.
  timeoutMs?: number
}

type BraveResponse = {
  web?: {
    results?: Array<{ url?: string; title?: string; description?: string }> | null
  } | null
}

let callCount = 0

export function braveSearchCallCount(): number {
  return callCount
}

export function resetBraveSearchCallCount(): void {
  callCount = 0
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defaultNow(): number {
  return Date.now()
}

function isValidBraveResponse(body: unknown): body is BraveResponse {
  if (!body || typeof body !== 'object') return false
  const web = (body as { web?: unknown }).web
  if (!web || typeof web !== 'object') return false
  const results = (web as { results?: unknown }).results
  // We require an actual array (possibly empty) to consider the response well-formed.
  return Array.isArray(results)
}

function toCandidate(raw: { url?: string; title?: string; description?: string }): RawCandidate | null {
  if (typeof raw.url !== 'string' || raw.url.length === 0) return null
  let url: URL
  try {
    url = new URL(raw.url)
  } catch {
    return null
  }
  if (url.protocol !== 'https:') return null
  return {
    url: url.toString(),
    title: typeof raw.title === 'string' ? raw.title : '',
    snippet: typeof raw.description === 'string' ? raw.description : '',
    host: url.host.toLowerCase(),
  }
}

function rankToSearchCandidate(ranked: RankedCandidate): SearchCandidate {
  return { url: ranked.url, title: ranked.title, snippet: ranked.snippet, host: ranked.host }
}

function buildQueries(manufacturer: string, model: string): string[] {
  const head = `${manufacturer} ${model}`.trim()
  return [`${head} user manual`, `${head} instruction manual`, `${head} maintenance`]
}

export async function searchManuals(
  args: { manufacturer: string; model: string },
  options: BraveSearchCallOptions = {},
): Promise<SearchResult> {
  const env = options.env ?? process.env
  const apiKey = env[API_KEY_ENV]?.trim()
  if (!apiKey) {
    // Missing key: never call the API, never count a call.
    return { status: 'unavailable' }
  }

  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? defaultNow
  const sleep = options.sleep ?? defaultSleep
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const manufacturerDomains = options.manufacturerDomains ?? DEFAULT_MANUFACTURER_DOMAINS

  const queries = buildQueries(args.manufacturer.trim(), args.model.trim())
  const collected: RawCandidate[] = []
  let lastReason: SearchReason = 'no_results'
  let lastRetryAfterMs: number | null = null
  let nextCallAllowedAt = now()

  for (const q of queries) {
    const gap = Math.max(0, nextCallAllowedAt - now())
    if (gap > 0) await sleep(gap)
    callCount++

    const response = await callBrave(fetchImpl, apiKey, q, timeoutMs, options.abortSignal)
    if (response.kind === 'rate_limited') {
      // Honour Retry-After for the next call's pacing but keep issuing the remaining
      // query variants so the CFO cost view reflects the calls we actually made. We
      // don't retry the same query (the spec says "stops on 429" between variants).
      lastReason = 'rate_limited'
      lastRetryAfterMs = response.resetMs
    } else if (response.kind === 'timeout') {
      lastReason = 'timeout'
    } else if (response.kind === 'network_error') {
      lastReason = 'network_error'
    } else if (response.kind === 'http_error') {
      lastReason = 'http_error'
    } else if (response.kind === 'malformed_response') {
      lastReason = 'malformed_response'
    } else if (response.kind === 'ok') {
      for (const c of response.candidates) collected.push(c)
    }

    // Schedule the next attempt: at least MIN_GAP_MS after this one, or honour Retry-After.
    const backoff = lastRetryAfterMs ?? MIN_GAP_MS
    nextCallAllowedAt = now() + backoff
    lastRetryAfterMs = null
  }

  // Dedupe and rank.
  const ranked = rankCandidates(collected, {
    manufacturer: args.manufacturer,
    model: args.model,
    manufacturerDomains,
  })

  if (ranked.length === 0) {
    return { status: 'empty', candidates: [], reason: lastReason }
  }
  return { status: 'ok', candidates: ranked.map(rankToSearchCandidate) }
}

type BraveCallOutcome =
  | { kind: 'ok'; candidates: RawCandidate[] }
  | { kind: 'rate_limited'; resetMs: number }
  | { kind: 'timeout' }
  | { kind: 'network_error' }
  | { kind: 'http_error' }
  | { kind: 'malformed_response' }

async function callBrave(
  fetchImpl: typeof fetch,
  apiKey: string,
  query: string,
  timeoutMs: number,
  parentSignal: AbortSignal | undefined,
): Promise<BraveCallOutcome> {
  const url = new URL(BRAVE_BASE_URL)
  url.searchParams.set('q', query)
  url.searchParams.set('count', String(DEFAULT_RESULTS_PER_QUERY))

  const timeoutController = new AbortController()
  const timeoutHandle = setTimeout(() => timeoutController.abort(), timeoutMs)
  const composedSignal = composeSignals(timeoutController.signal, parentSignal)
  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        // API key is sent only in this header — never in the URL, body, or logs.
        'X-Subscription-Token': apiKey,
      },
      signal: composedSignal,
    })
    if (response.status === 429) {
      return { kind: 'rate_limited', resetMs: parseRetryAfter(response.headers.get('retry-after')) }
    }
    if (!response.ok) {
      return { kind: 'http_error' }
    }
    const body = (await response.json()) as unknown
    if (!isValidBraveResponse(body)) {
      return { kind: 'malformed_response' }
    }
    const results = body.web?.results ?? []
    const candidates: RawCandidate[] = []
    for (const r of results) {
      const c = toCandidate(r)
      if (c) candidates.push(c)
    }
    return { kind: 'ok', candidates }
  } catch (err) {
    if (isAbort(err)) return { kind: 'timeout' }
    return { kind: 'network_error' }
  } finally {
    clearTimeout(timeoutHandle)
  }
}

function isAbort(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  return name === 'AbortError' || name === 'TimeoutError'
}

function parseRetryAfter(value: string | null): number {
  if (!value) return MIN_GAP_MS
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds > 0) return Math.max(MIN_GAP_MS, Math.ceil(seconds * 1000))
  // HTTP-date form: try to parse; fall back to the minimum gap.
  const date = Date.parse(value)
  if (Number.isFinite(date)) {
    const delta = date - Date.now()
    return Math.max(MIN_GAP_MS, delta)
  }
  return MIN_GAP_MS
}

function composeSignals(a: AbortSignal, b: AbortSignal | undefined): AbortSignal {
  if (!b) return a
  if (a.aborted) return a
  if (b.aborted) return b
  const controller = new AbortController()
  const onA = () => controller.abort(a.reason)
  const onB = () => controller.abort(b.reason)
  a.addEventListener('abort', onA, { once: true })
  b.addEventListener('abort', onB, { once: true })
  return controller.signal
}

export const __testing = { isValidBraveResponse, toCandidate, buildQueries, parseRetryAfter, hostOf, MIN_GAP_MS }
