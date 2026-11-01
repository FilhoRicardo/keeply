import 'server-only'
import { presentInterval, quoteWithPageCadence } from '@/domain/cadence'
import { classifyEvidence } from '@/domain/evidence-check'
import { manualSourceTitle } from '@/domain/manual-title'
import { COVER_PAGE_COUNT, coverWindowText, matchingCoverModel, modelFamily } from '@/domain/model-family'
import type { Source, SourceType, TaskProposal } from '@/domain/model'
import type { ExtractedTaskCandidate } from '@/ai/extraction'
import type { SearchResult } from '@/search/brave'
import type { FetchResult, DocType } from '@/search/fetch-document'
import type { ExtractResult } from '@/search/extract-pages'
import type { BraveReserveResult } from '@/db/brave-quota'
import type { ManufacturerDomainMap } from '@/search/rank'
import { emptySearchToPlanOutcome } from './plan-search-outcomes'
import type { PlanRunLog } from './plan-run-log'

// Orchestrates Phase 3's manual search for a confirmed appliance: confirmed model -> Brave Search
// -> fetchDocument + extractPages -> extractTasks -> classifyEvidence -> TaskProposal[]. The model
// never decides the evidence level. KEE-60: any household appliance, not only dishwashers.
// Fallbacks in order: similar-model (a cover-page model number in the same family, with a
// code-checked quote) -> general guidance when the appliance is a dishwasher, or "no plan found"
// for everything else. Manual search and the existing path always work for dishwashers.
//
// Every external step is in `deps`, so a test can fake Brave, the document fetch, the AI provider
// and the durable quota counter. The route owns the time budget and an AbortSignal.

export type BraveSearch = (
  args: { manufacturer: string; model: string },
) => Promise<SearchResult>

export type FetchDocumentFn = (url: string) => Promise<FetchResult>

export type ExtractPagesFn = (bytes: Uint8Array, type: DocType) => Promise<ExtractResult>

export type ExtractTasksFn = (
  input: { model: string; pages: readonly { page: number; text: string }[] },
) => Promise<ExtractedTaskCandidate[] | 'unavailable'>

export type ReserveBraveFn = () => Promise<BraveReserveResult>

export type SourceResolver = (url: string) => {
  // The set of model identifiers the document claims to cover. classifyEvidence uses this to decide
  // Manufacturer verified (model is in the list) vs Similar-model vs General.
  documentModels: string[]
  // Unused for classification. The family comes from model numbers on the cover pages, not from
  // this resolver, so a URL cannot invent a product family.
  documentFamily?: string
}

export type PlanDeps = {
  reserveBraveSearch: ReserveBraveFn
  searchManuals: BraveSearch
  fetchDocument: FetchDocumentFn
  extractPages: ExtractPagesFn
  extractTasks: ExtractTasksFn
  resolveSource: SourceResolver
  manufacturerDomains: ManufacturerDomainMap
  // Final fallback when no manual yields a verified or even similar-model task. Honest general
  // guidance: the existing `GENERAL_DISHWASHER_TASKS`.
  generalGuidance: () => readonly TaskProposal[]
  // Picks the AI model name to pass into `provider.extractTasks`. The provider decides whether it
  // actually reads manuals; the orchestration owns the budget.
  aiModel: string
  // Signal for the overall time budget (the route sets this to a single ~25 s AbortController).
  signal: AbortSignal
  // Each candidate download gives up after CANDIDATE_FETCH_TIMEOUT_MS. Tests replace this so
  // they can fire that deadline without waiting on the wall clock. Default is setTimeout.
  scheduleTimeout?: (ms: number, onFire: () => void) => () => void
  // Filled during proposePlan for the route's counts-only log line.
  runLog?: Partial<PlanRunLog>
}

export type SearchOutcome =
  | 'ok'
  | 'no_results'
  | 'search_error'
  | 'search_empty'
  | 'manual_found_ai_no_tasks'
  | 'quota_exhausted'
  | 'fetch_failed'
  | 'extraction_unavailable'
  | 'unreadable'
  | 'no_text'
  | 'timeout'
  | 'no_plan'

// The classifier the orchestration uses to decide the evidence level. Imported from
// src/domain/evidence-check.ts; the test can pass a stub. The function is a real function (not a
// type) so that `classifyEvidence` can be exported as the production wiring.
export type ClassifyEvidence = typeof classifyEvidence

// What the route returns to the client. Counts only in the outcome; no per-task document text or
// page content. Manual and the old general-guidance path always return at least one proposal
// for dishwashers. KEE-60: for non-dishwashers, `fallback` may be 'general' with empty proposals
// and `searchOutcome === 'no_plan'` — the UI shows a plain "no plan could be built" message.
export type PlanOutcome = {
  proposals: readonly TaskProposal[]
  fallback: 'exact' | 'similar' | 'general'
  searchOutcome: SearchOutcome
  // The Brave search reason when the search itself didn't yield ok (e.g. 'rate_limited'). UI text
  // can interpret this; the outcome field above is enough to drive the funnel.
  searchReason: string | null
  // When a manual matched on the cover but no tasks could be extracted. Omitted from DB storage.
  manualUrl?: string | null
}

const GENERAL_GUIDANCE_TITLE = 'Keeply general dishwasher maintenance guidance'

function generalSource(): Source {
  return { type: 'general_guidance', title: GENERAL_GUIDANCE_TITLE, url: null, location: null, quote: null }
}

// KEE-60: True when the appliance category is "dishwasher" (case-insensitive). Other appliance
// types never use the hand-curated general-guidance list; they show an honest "no plan" path.
function isDishwasher(category: string | null | undefined): boolean {
  return typeof category === 'string' && category.trim().toLowerCase() === 'dishwasher'
}

// The P3-1 source for a Manufacturer verified task. The evidence_supported check in the migration
// requires a manufacturer manual or website with an https link and a quote; we have all three.
function manufacturerSource(args: {
  url: string
  title: string
  page: number
  quote: string
}): Source {
  // Best-effort source type. If the URL looks like a PDF we use 'manufacturer_manual'; otherwise the
  // URL is on a manufacturer domain (per classifyEvidence) and 'manufacturer_website' applies.
  // Both are accepted by the database evidence_supported check.
  const isLikelyPdf = args.url.toLowerCase().endsWith('.pdf')
  const type: SourceType = isLikelyPdf ? 'manufacturer_manual' : 'manufacturer_website'
  return { type, title: args.title, url: args.url, location: `page ${args.page}`, quote: args.quote }
}

function similarModelSource(args: {
  url: string
  title: string
  page: number
  quote: string
  coveredModel: string
}): Source {
  return {
    type: 'similar_model_manual',
    title: args.title,
    url: args.url,
    location: `page ${args.page}`,
    quote: args.quote,
    coveredModel: args.coveredModel,
  }
}

function timedOut(signal: AbortSignal): boolean {
  return signal.aborted
}

function safePageText(pages: ReadonlyArray<{ page: number; text: string }>, page: number): string {
  return pages.find((p) => p.page === page)?.text ?? ''
}

// Search already returns at most 5 (the ranker cap). Read all of them. AI stays capped at 3.
const MAX_DOWNLOAD_CANDIDATES = 5
const MAX_EXTRACT_TASKS = 3
// Per-download deadline, inside the route's 25s plan budget. A slow file is skipped.
export const CANDIDATE_FETCH_TIMEOUT_MS = 8_000

function defaultScheduleTimeout(ms: number, onFire: () => void): () => void {
  const id = setTimeout(onFire, ms)
  return () => clearTimeout(id)
}

// Same https host check classifyEvidence uses, so "manufacturer domain" in the AI order is a
// document that can actually be manufacturer-verified. Not a change to that classifier.
function hostedByManufacturer(url: string, domains: readonly string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return domains.some((domain) => {
    const wanted = domain.trim().toLowerCase()
    return wanted !== '' && (host === wanted || host.endsWith(`.${wanted}`))
  })
}

// Exact model on the cover, otherwise a same-family model on that same cover window.
// Anything else is not worth an AI call.
function coverKind(pages: readonly { page: number; text: string }[], model: string): 'exact' | 'family' | null {
  if (coversModel(pages, model)) return 'exact'
  if (matchingCoverModel(pages, model)) return 'family'
  return null
}

type PreparedCandidate =
  | { rank: number; failure: SearchOutcome }
  | { rank: number; missedCover: true }
  | {
      rank: number
      url: string
      pages: readonly { page: number; text: string; title?: string }[]
      documentTitle: string | null
      kind: 'exact' | 'family'
      manufacturerSite: boolean
    }

function fetchWithinBudget(url: string, deps: PlanDeps): Promise<FetchResult> {
  if (timedOut(deps.signal)) return Promise.resolve({ ok: false, reason: 'timeout' })
  const schedule = deps.scheduleTimeout ?? defaultScheduleTimeout
  return new Promise((resolve) => {
    let settled = false
    let cancel = () => {}
    const finish = (result: FetchResult) => {
      if (settled) return
      settled = true
      cancel()
      deps.signal.removeEventListener('abort', onAbort)
      resolve(result)
    }
    const onAbort = () => finish({ ok: false, reason: 'timeout' })
    cancel = schedule(CANDIDATE_FETCH_TIMEOUT_MS, () => finish({ ok: false, reason: 'timeout' }))
    deps.signal.addEventListener('abort', onAbort, { once: true })
    deps.fetchDocument(url).then(finish, () => finish({ ok: false, reason: 'fetch_failed' }))
  })
}

async function prepareCandidate(
  candidate: { url: string; title: string },
  rank: number,
  model: string,
  domains: readonly string[],
  deps: PlanDeps,
): Promise<PreparedCandidate> {
  const fetched = await fetchWithinBudget(candidate.url, deps)
  if (!fetched.ok) {
    return { rank, failure: fetched.reason === 'timeout' ? 'timeout' : 'fetch_failed' }
  }
  let extracted: ExtractResult
  try {
    extracted = await deps.extractPages(fetched.bytes, fetched.type)
  } catch {
    return { rank, failure: 'unreadable' }
  }
  if (!extracted.ok) {
    return { rank, failure: extracted.reason === 'unreadable' ? 'unreadable' : 'no_text' }
  }
  const kind = coverKind(extracted.pages, model)
  if (!kind) return { rank, missedCover: true }
  return {
    rank,
    url: fetched.url,
    pages: extracted.pages,
    documentTitle: documentTitleFrom(extracted),
    kind,
    manufacturerSite: hostedByManufacturer(fetched.url, domains),
  }
}

// PDF metadata, or the HTML <title>. A search-result title is not a document title: Brave often
// labels a direct PDF with the host ("Electrolux-medialibrary") or a file name.
function documentTitleFrom(extracted: {
  documentTitle?: string | null
  pages: readonly { title?: string }[]
}): string | null {
  const named = extracted.documentTitle?.replace(/\s+/g, ' ').trim()
  if (named) return named
  for (const page of extracted.pages) {
    const title = page.title?.trim()
    if (title) return title
  }
  return null
}

function aiGroup(item: Extract<PreparedCandidate, { kind: 'exact' | 'family' }>): number {
  if (item.kind === 'exact' && item.manufacturerSite) return 0
  if (item.kind === 'exact') return 1
  return 2
}

// The source resolver cannot tell from a URL which models a document covers, so we read the cover:
// a manual whose cover names the exact model (as a whole token, not a prefix of a longer model
// number) covers it. PDF cover pages are 1–2 in full. An HTML page (title field set by
// extract-pages) uses the title plus the first 2,000 characters. A model only deeper does not.
function coversModel(pages: readonly { page: number; text: string; title?: string }[], model: string): boolean {
  const wanted = model.trim()
  if (!wanted) return false
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const whole = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i')
  return pages.some((p) => p.page <= COVER_PAGE_COUNT && whole.test(coverWindowText(p)))
}

function isReady(item: PreparedCandidate): item is Extract<PreparedCandidate, { kind: 'exact' | 'family' }> {
  return 'kind' in item
}

// Downloads every candidate search returned (up to 5) in parallel, drops any whose cover does
// not name the owner's model or the same family, then asks the AI about at most 3 that remain.
// Order: exact model on a manufacturer domain, then exact model elsewhere, then family-only,
// Brave's rank inside each group. The first verified plan ends the search.
async function findPlans(
  args: {
    manufacturer: string
    model: string
    candidates: readonly { url: string; title: string }[]
  },
  deps: PlanDeps,
): Promise<{ outcome: SearchOutcome; proposals: TaskProposal[]; manualUrl: string | null; aiTasks: number; quotePass: number }> {
  if (timedOut(deps.signal)) return { outcome: 'timeout', proposals: [], manualUrl: null, aiTasks: 0, quotePass: 0 }
  const domains = deps.manufacturerDomains[args.manufacturer.toLowerCase()] ?? []
  const downloaded = await Promise.all(
    args.candidates.slice(0, MAX_DOWNLOAD_CANDIDATES).map((candidate, rank) =>
      prepareCandidate(candidate, rank, args.model, domains, deps),
    ),
  )
  // The plan budget fired while downloads were in flight. A single slow file is not this case:
  // that download is skipped above and the others are still used.
  if (timedOut(deps.signal)) return { outcome: 'timeout', proposals: [], manualUrl: null, aiTasks: 0, quotePass: 0 }

  const ready = downloaded.filter(isReady).sort((a, b) => aiGroup(a) - aiGroup(b) || a.rank - b.rank)
  if (deps.runLog) deps.runLog.coverMatches = ready.length
  if (ready.length === 0) {
    if (downloaded.some((item) => 'missedCover' in item)) {
      return { outcome: 'no_results', proposals: [], manualUrl: null, aiTasks: 0, quotePass: 0 }
    }
    const failures = downloaded.filter((item): item is { rank: number; failure: SearchOutcome } => 'failure' in item)
    const last = failures.sort((a, b) => a.rank - b.rank).at(-1)
    return { outcome: last?.failure ?? 'no_results', proposals: [], manualUrl: null, aiTasks: 0, quotePass: 0 }
  }

  const exact: TaskProposal[] = []
  const similar: TaskProposal[] = []
  const priorFailure = downloaded
    .filter((item): item is { rank: number; failure: SearchOutcome } => 'failure' in item)
    .sort((a, b) => a.rank - b.rank)
    .at(-1)
  let lastReason: SearchOutcome = priorFailure?.failure ?? 'no_results'
  let manualUrl: string | null = ready[0]?.url ?? null
  let aiTasks = 0
  let quotePass = 0
  let triedAiOnCoverMatch = false
  for (const item of ready.slice(0, MAX_EXTRACT_TASKS)) {
    if (timedOut(deps.signal)) return { outcome: 'timeout', proposals: [], manualUrl, aiTasks, quotePass }
    const candidates = await deps.extractTasks({ model: args.model, pages: item.pages })
    if (candidates === 'unavailable') {
      lastReason = 'extraction_unavailable'
      continue
    }
    triedAiOnCoverMatch = true
    manualUrl = item.url
    if (candidates.length === 0) {
      lastReason = 'manual_found_ai_no_tasks'
      continue
    }
    aiTasks += candidates.length
    const resolved = deps.resolveSource(item.url)
    const documentModels = [...resolved.documentModels]
    if (coversModel(item.pages, args.model) && !documentModels.includes(args.model)) documentModels.push(args.model)
    // Family is derived from the confirmed model and the cover pages. A client-sent family and
    // the resolver's documentFamily are ignored, so neither can raise or invent a level.
    const ownerFamily = modelFamily(args.model) ?? undefined
    const coveredModel = matchingCoverModel(item.pages, args.model)
    const verifiedTitle = manualSourceTitle({
      documentTitle: item.documentTitle,
      manufacturer: args.manufacturer,
      model: args.model,
    })
    const similarTitle = coveredModel
      ? manualSourceTitle({
          documentTitle: item.documentTitle,
          manufacturer: args.manufacturer,
          model: coveredModel,
        })
      : verifiedTitle
    for (const c of candidates) {
      const documentText = safePageText(item.pages, c.page)
      const quote = quoteWithPageCadence(c.quote, documentText)
      const verdict = classifyEvidence({
        source: {
          url: item.url,
          page: c.page,
          documentModels,
          documentFamily: coveredModel ? ownerFamily : undefined,
        },
        model: { name: args.model, family: ownerFamily },
        manufacturerDomains: [...domains],
        task: c.task,
        quote,
        documentText,
      })
      const interval = presentInterval({
        quote,
        stored: c.interval,
        generalGuidance: false,
      }).interval
      if (verdict.level === 'manufacturer_verified') {
        quotePass++
        exact.push({
          name: c.task,
          instructions: c.instructions,
          interval,
          evidenceLevel: 'manufacturer_verified',
          source: manufacturerSource({ url: item.url, title: verifiedTitle, page: c.page, quote }),
        })
      } else if (verdict.level === 'similar_model' && coveredModel) {
        quotePass++
        similar.push({
          name: c.task,
          instructions: c.instructions,
          interval,
          evidenceLevel: 'similar_model',
          source: similarModelSource({ url: item.url, title: similarTitle, page: c.page, quote, coveredModel }),
        })
      }
      // General guidance items from a manual go to /dev/null — we already have `generalGuidance()`
      // and will fall back to it when the manual yielded nothing better.
    }
    // The first manual that returned at least one verified task ends the exact-model search.
    if (exact.length > 0) return { outcome: 'ok', proposals: exact, manualUrl: null, aiTasks, quotePass }
  }
  if (similar.length > 0) {
    const outcome = lastReason === 'manual_found_ai_no_tasks' ? lastReason : lastReason === 'no_results' ? 'no_results' : lastReason
    return { outcome, proposals: similar, manualUrl: null, aiTasks, quotePass }
  }
  if (
    triedAiOnCoverMatch &&
    exact.length === 0 &&
    similar.length === 0 &&
    (lastReason === 'no_results' || (aiTasks > 0 && quotePass === 0))
  ) {
    lastReason = 'manual_found_ai_no_tasks'
  }
  return { outcome: lastReason, proposals: [], manualUrl: lastReason === 'manual_found_ai_no_tasks' ? manualUrl : null, aiTasks, quotePass }
}

// Drives the full orchestration. Every failure returns the general-guidance fallback so the route
// can hand the client a guaranteed plan; the searchOutcome carries the reason for the funnel.
// KEE-60: only dishwashers use the general-guidance fallback. Other appliance types return an
// empty plan with searchOutcome 'no_plan' when the search yields nothing.
// `modelFamily`, when present, is ignored. The family used for Similar-model comes from the
// confirmed model number, so a client cannot choose the evidence level.
export async function proposePlan(
  args: { manufacturer: string; model: string; modelFamily?: string; applianceType?: string | null },
  deps: PlanDeps,
): Promise<PlanOutcome> {
  const isDish = isDishwasher(args.applianceType)
  const fallbackGeneral = (): readonly TaskProposal[] =>
    isDish ? deps.generalGuidance().map((p) => ({ ...p, source: generalSource() })) : []
  const noPlan = (): PlanOutcome => ({
    proposals: [],
    fallback: 'general',
    searchOutcome: 'no_plan',
    searchReason: 'no_plan',
  })

  if (timedOut(deps.signal)) {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'timeout', searchReason: 'timeout' }
    return { proposals: [], fallback: 'general', searchOutcome: 'timeout', searchReason: 'timeout' }
  }
  // Step 1: durable counter check. Runs BEFORE searchManuals so a refused call is never started
  // (CEO directive, 2026-10-05). Once at the cap the Brave fetch is never made (asserted in tests).
  const reservation = await deps.reserveBraveSearch()
  if (reservation === 'quota_exhausted') {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'quota_exhausted', searchReason: 'quota_exhausted' }
    return { ...noPlan(), searchOutcome: 'quota_exhausted', searchReason: 'quota_exhausted' }
  }
  if (timedOut(deps.signal)) {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'timeout', searchReason: 'timeout' }
    return { proposals: [], fallback: 'general', searchOutcome: 'timeout', searchReason: 'timeout' }
  }

  // Step 2: discovery.
  const search = await deps.searchManuals({ manufacturer: args.manufacturer, model: args.model })
  if (search.status === 'unavailable') {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'no_results', searchReason: 'no_key' }
    return { ...noPlan(), searchReason: 'no_key' }
  }
  if (search.status === 'empty') {
    const mapped = emptySearchToPlanOutcome(search.reason)
    if (deps.runLog) {
      deps.runLog.braveStatus = search.braveStatus
      deps.runLog.candidates = 0
      deps.runLog.coverMatches = 0
      deps.runLog.aiTasks = 0
      deps.runLog.quotePass = 0
      deps.runLog.outcome = mapped.searchOutcome
    }
    if (isDish) {
      return {
        proposals: fallbackGeneral(),
        fallback: 'general',
        searchOutcome: mapped.searchOutcome,
        searchReason: mapped.searchReason,
      }
    }
    return { ...noPlan(), searchOutcome: mapped.searchOutcome, searchReason: mapped.searchReason }
  }
  // search.status === 'ok'. Candidates exist, so a timeout from here on is download or reading,
  // not the search step. searchReason stays null so the banner does not claim the search timed out.
  if (timedOut(deps.signal)) {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'timeout', searchReason: null }
    return { proposals: [], fallback: 'general', searchOutcome: 'timeout', searchReason: null }
  }
  if (deps.runLog) {
    deps.runLog.braveStatus = search.braveStatus
    deps.runLog.candidates = search.candidates.length
  }
  const find = await findPlans(
    { manufacturer: args.manufacturer, model: args.model, candidates: search.candidates },
    deps,
  )
  if (deps.runLog) {
    deps.runLog.aiTasks = find.aiTasks
    deps.runLog.quotePass = find.quotePass
    deps.runLog.outcome = find.outcome
  }
  if (find.proposals.length > 0) {
    const fallback: PlanOutcome['fallback'] = find.proposals.some((p) => p.evidenceLevel === 'manufacturer_verified')
      ? 'exact'
      : 'similar'
    return { proposals: find.proposals, fallback, searchOutcome: find.outcome, searchReason: null }
  }
  const manualUrl = find.manualUrl
  if (isDish) {
    return {
      proposals: fallbackGeneral(),
      fallback: 'general',
      searchOutcome: find.outcome,
      searchReason: null,
      ...(manualUrl ? { manualUrl } : {}),
    }
  }
  return { ...noPlan(), searchOutcome: find.outcome, ...(manualUrl ? { manualUrl } : {}) }
}
