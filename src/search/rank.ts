// Pure ranking for Brave Search results. No IO, no network, no env — easy to test.
//
// Inputs are normalised Brave results; outputs are deduplicated, scored and ordered candidates
// with a stable, deterministic tie-break. The scoring favours (a) the manufacturer's own domain,
// (b) PDF and manual-looking URLs, and (c) an explicit model match. Hosts that look like resellers,
// forums, or social platforms are dropped, as are non-https URLs and obvious look-alike domains.

export type RawCandidate = {
  url: string
  title: string
  snippet: string
  host: string
}

export type RankedCandidate = RawCandidate & {
  score: number
  manufacturerMatch: boolean
  pdf: boolean
  manualLooking: boolean
}

export type ManufacturerDomainMap = Record<string, readonly string[]>

export type RankOptions = {
  manufacturer: string
  model: string
  manufacturerDomains: ManufacturerDomainMap
  cap?: number
}

const DEFAULT_CAP = 5

// Bare second-level labels that should never be considered a manufacturer match on their own.
// Used to refuse "bosch-" / "bosch." style hyphenated look-alikes.
const DISALLOWED_MANUFACTURER_LABELS = new Set(['www'])

// Reseller / forum / social hosts. Matched as exact host or as the registrable suffix
// (so e.g. "old.reddit.com" is also dropped).
const RESELLER_HOSTS = new Set([
  'amazon.com',
  'ebay.com',
  'walmart.com',
  'aliexpress.com',
  'alibaba.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'youtube.com',
  'linkedin.com',
  'pinterest.com',
  'reddit.com',
])

const RESELLER_HOST_TOKENS = ['amazon', 'ebay', 'walmart', 'aliexpress', 'alibaba']

const FORUM_HOST_TOKENS = ['reddit', 'stackexchange', 'stack-overflow', 'stackoverflow', 'quora']

// Heuristic signal phrases for "looks like a manual".
const MANUAL_TOKENS = ['manual', 'instruction', 'handbuch', 'guide', 'user-guide', 'owner', 'service', 'spec', 'datasheet']

// `manufacturers` maps a normalised brand token to a list of trusted registrable domains.
// Only the bare host of these domains (or any subdomain of one) earns the manufacturer boost.
export function buildDefaultManufacturerDomains(): ManufacturerDomainMap {
  return {
    bosch: ['bosch.com', 'bosch-home.com'],
    miele: ['miele.com'],
    electrolux: ['electrolux.com'],
    samsung: ['samsung.com'],
    lg: ['lg.com'],
    beko: ['beko.com'],
    smeg: ['smeg.com'],
    aeg: ['aeg.com'],
    siemens: ['siemens.com', 'siemens-home.com'],
    neff: ['neff.com', 'neff-home.com'],
  }
}

// The host of `url`, lowercased and IDN-punycoded conservatively.
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return null
  }
}

// Returns true if `host` is a domain that belongs to the given manufacturer (allowing
// subdomains). Hyphenated look-alikes (bosch-anything.com) are rejected because
// `manufacturers` only lists the exact registrable domains.
export function isManufacturerHost(
  host: string,
  manufacturer: string,
  manufacturers: ManufacturerDomainMap,
): boolean {
  const domains = manufacturers[manufacturer.toLowerCase()]
  if (!domains) return false
  const bareHost = bareRegistrableHost(host)
  if (DISALLOWED_MANUFACTURER_LABELS.has(bareHost)) return false
  for (const domain of domains) {
    if (bareHost === domain) return true
    if (bareHost.endsWith(`.${domain}`)) return true
  }
  return false
}

// Reduces e.g. "support.bosch-home.com" to "bosch-home.com" — we use this for the
// reseller/forum filter, not for the manufacturer match.
export function bareRegistrableHost(host: string): string {
  const labels = host.split('.').filter(Boolean)
  if (labels.length <= 2) return host
  return labels.slice(-2).join('.')
}

function isResellerOrForum(host: string): boolean {
  const lower = host.toLowerCase()
  if (RESELLER_HOSTS.has(lower)) return true
  const registrable = bareRegistrableHost(lower)
  if (RESELLER_HOSTS.has(registrable)) return true
  for (const token of RESELLER_HOST_TOKENS) if (registrable.includes(token)) return true
  for (const token of FORUM_HOST_TOKENS) if (registrable.includes(token)) return true
  return false
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function looksLikePdf(url: string): boolean {
  try {
    return new URL(url).pathname.toLowerCase().endsWith('.pdf')
  } catch {
    return false
  }
}

function looksLikeManual(text: string): boolean {
  const lower = text.toLowerCase()
  return MANUAL_TOKENS.some((token) => lower.includes(token))
}

function modelMatches(text: string, model: string): boolean {
  if (!model) return false
  return text.toLowerCase().includes(model.toLowerCase())
}

function candidateText(c: RawCandidate): string {
  return [c.title, c.snippet, c.url].join(' ')
}

function dedupeByUrl(candidates: RawCandidate[]): RawCandidate[] {
  const seen = new Set<string>()
  const out: RawCandidate[] = []
  for (const c of candidates) {
    if (seen.has(c.url)) continue
    seen.add(c.url)
    out.push(c)
  }
  return out
}

export function rankCandidates(
  candidates: readonly RawCandidate[],
  options: RankOptions,
): RankedCandidate[] {
  const cap = options.cap ?? DEFAULT_CAP
  const model = options.model.trim()
  const manufacturer = options.manufacturer.trim()
  const manufacturers = options.manufacturerDomains

  const deduped = dedupeByUrl([...candidates])
  const ranked: RankedCandidate[] = []

  for (const c of deduped) {
    if (!isHttps(c.url)) continue
    const host = hostOf(c.url) ?? c.host.toLowerCase()
    if (isResellerOrForum(host)) continue
    const manufacturerMatch = isManufacturerHost(host, manufacturer, manufacturers)
    const pdf = looksLikePdf(c.url)
    const manualLooking = looksLikeManual(candidateText(c))
    const text = candidateText(c)

    let score = 0
    if (manufacturerMatch) score += 100
    if (pdf) score += 30
    if (manualLooking) score += 20
    if (modelMatches(text, model)) score += 20

    ranked.push({ ...c, host, score, manufacturerMatch, pdf, manualLooking })
  }

  ranked.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score
    if (a.url < b.url) return -1
    if (a.url > b.url) return 1
    return 0
  })

  return ranked.slice(0, cap)
}
