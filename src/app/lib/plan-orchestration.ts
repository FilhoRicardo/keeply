import 'server-only'
import { classifyEvidence } from '@/domain/evidence-check'
import type { Source, SourceType, TaskProposal } from '@/domain/model'
import type { ExtractedTaskCandidate } from '@/ai/extraction'
import type { SearchResult } from '@/search/brave'
import type { FetchResult, DocType } from '@/search/fetch-document'
import type { ExtractResult } from '@/search/extract-pages'
import type { BraveReserveResult } from '@/db/brave-quota'
import type { ManufacturerDomainMap } from '@/search/rank'

// Orchestrates Phase 3's manual search for a confirmed appliance: confirmed model -> Brave Search
// -> fetchDocument + extractPages -> extractTasks -> classifyEvidence -> TaskProposal[]. The model
// never decides the evidence level. KEE-60: any household appliance, not only dishwashers.
// Fallbacks in order: similar-model (quotes that match the same product family) -> general
// guidance when the appliance is a dishwasher, or "no plan found" for everything else. Manual
// search and the existing path always work for dishwashers.
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
  // The product family the document belongs to (e.g. Bosch 'SMS6' series). A manual with the same
  // family as the requested model keeps the candidate at Similar-model (not General).
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
  // The friendly display title for the manual once it is fetched.
  candidateTitle: (url: string) => string
  // Picks the AI model name to pass into `provider.extractTasks`. The provider decides whether it
  // actually reads manuals; the orchestration owns the budget.
  aiModel: string
  // Signal for the overall time budget (the route sets this to a single ~25 s AbortController).
  signal: AbortSignal
}

export type SearchOutcome =
  | 'ok'
  | 'no_results'
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

function similarModelSource(args: { url: string; title: string; page: number; quote: string }): Source {
  return {
    type: 'similar_model_manual',
    title: args.title,
    url: args.url,
    location: `page ${args.page}`,
    quote: args.quote,
  }
}

function timedOut(signal: AbortSignal): boolean {
  return signal.aborted
}

function safePageText(pages: ReadonlyArray<{ page: number; text: string }>, page: number): string {
  return pages.find((p) => p.page === page)?.text ?? ''
}

const MAX_MANUAL_CANDIDATES = 3

// The source resolver cannot tell from a URL which models a document covers, so we read the cover
// pages: a manual whose first pages name the exact model (as a whole token, not a prefix of a longer
// model number) covers it. A model mentioned only deeper in the document does not.
const COVER_PAGES = 2

function coversModel(pages: readonly { page: number; text: string }[], model: string): boolean {
  const wanted = model.trim()
  if (!wanted) return false
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const whole = new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`, 'i')
  return pages.some((p) => p.page <= COVER_PAGES && whole.test(p.text))
}

// Walks the ranked Brave candidates and tries each until one yields a manufacturer-verified plan.
// If none of the top MAX_MANUAL_CANDIDATES yields a verified plan but at least one yields
// similar-model tasks (same family), the similar-model tasks become the plan. Otherwise nothing
// useful came from Brave and the caller falls back to general guidance.
async function findPlans(
  args: {
    manufacturer: string
    model: string
    modelFamily: string | undefined
    candidates: readonly { url: string; title: string }[]
  },
  deps: PlanDeps,
): Promise<{ outcome: SearchOutcome; proposals: TaskProposal[] }> {
  const exact: TaskProposal[] = []
  const similar: TaskProposal[] = []
  let lastReason: SearchOutcome = 'no_results'
  for (const candidate of args.candidates.slice(0, MAX_MANUAL_CANDIDATES)) {
    if (timedOut(deps.signal)) return { outcome: 'timeout', proposals: [] }
    const fetched = await deps.fetchDocument(candidate.url)
    if (!fetched.ok) {
      // One bad fetch must not kill the chain. Record and try the next candidate.
      lastReason = fetched.reason === 'timeout' ? 'timeout' : 'fetch_failed'
      continue
    }
    const extracted = await deps.extractPages(fetched.bytes, fetched.type)
    if (!extracted.ok) {
      lastReason = extracted.reason === 'unreadable' ? 'unreadable' : 'no_text'
      continue
    }
    if (timedOut(deps.signal)) return { outcome: 'timeout', proposals: [] }
    const candidates = await deps.extractTasks({ model: args.model, pages: extracted.pages })
    if (candidates === 'unavailable') {
      lastReason = 'extraction_unavailable'
      continue
    }
    if (candidates.length === 0) {
      lastReason = 'no_results'
      continue
    }
    const resolved = deps.resolveSource(fetched.url)
    const documentModels = [...resolved.documentModels]
    if (coversModel(extracted.pages, args.model) && !documentModels.includes(args.model)) documentModels.push(args.model)
    const title = candidate.title
    for (const c of candidates) {
      const documentText = safePageText(extracted.pages, c.page)
      const verdict = classifyEvidence({
        source: {
          url: fetched.url,
          page: c.page,
          documentModels,
          documentFamily: resolved.documentFamily,
        },
        model: { name: args.model, family: args.modelFamily },
        manufacturerDomains: [...(deps.manufacturerDomains[args.manufacturer.toLowerCase()] ?? [])],
        quote: c.quote,
        documentText,
      })
      if (verdict.level === 'manufacturer_verified') {
        exact.push({
          name: c.task,
          instructions: c.instructions,
          interval: c.interval,
          evidenceLevel: 'manufacturer_verified',
          source: manufacturerSource({ url: fetched.url, title, page: c.page, quote: c.quote }),
        })
      } else if (verdict.level === 'similar_model') {
        similar.push({
          name: c.task,
          instructions: c.instructions,
          interval: c.interval,
          evidenceLevel: 'similar_model',
          source: similarModelSource({ url: fetched.url, title, page: c.page, quote: c.quote }),
        })
      }
      // General guidance items from a manual go to /dev/null — we already have `generalGuidance()`
      // and will fall back to it when the manual yielded nothing better.
    }
    // The first manual that returned at least one verified task ends the exact-model search.
    if (exact.length > 0) return { outcome: 'ok', proposals: exact }
  }
  if (similar.length > 0) {
    const outcome = lastReason === 'no_results' ? 'no_results' : lastReason
    return { outcome, proposals: similar }
  }
  return { outcome: lastReason, proposals: [] }
}

// Drives the full orchestration. Every failure returns the general-guidance fallback so the route
// can hand the client a guaranteed plan; the searchOutcome carries the reason for the funnel.
// KEE-60: only dishwashers use the general-guidance fallback. Other appliance types return an
// empty plan with searchOutcome 'no_plan' when the search yields nothing.
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
    return noPlan()
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
    return noPlan()
  }

  // Step 2: discovery.
  const search = await deps.searchManuals({ manufacturer: args.manufacturer, model: args.model })
  if (search.status === 'unavailable') {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'no_results', searchReason: 'no_key' }
    return { ...noPlan(), searchReason: 'no_key' }
  }
  if (search.status === 'empty') {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'no_results', searchReason: search.reason }
    return { ...noPlan(), searchReason: search.reason }
  }
  // search.status === 'ok'. Walk candidates.
  if (timedOut(deps.signal)) {
    if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: 'timeout', searchReason: 'timeout' }
    return noPlan()
  }
  const find = await findPlans(
    { manufacturer: args.manufacturer, model: args.model, modelFamily: args.modelFamily, candidates: search.candidates },
    deps,
  )
  if (find.proposals.length > 0) {
    const fallback: PlanOutcome['fallback'] = find.proposals.some((p) => p.evidenceLevel === 'manufacturer_verified')
      ? 'exact'
      : 'similar'
    return { proposals: find.proposals, fallback, searchOutcome: find.outcome, searchReason: null }
  }
  if (isDish) return { proposals: fallbackGeneral(), fallback: 'general', searchOutcome: find.outcome, searchReason: null }
  return { ...noPlan(), searchOutcome: find.outcome }
}