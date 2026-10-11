import 'server-only'
import { buildDefaultManufacturerDomains, type ManufacturerDomainMap } from '@/search/rank'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import { selectProvider } from '@/ai/provider'
import { searchManuals } from '@/search/brave'
import { fetchDocument } from '@/search/fetch-document'
import { extractPages } from '@/search/extract-pages'
import { braveQuotaStatus, createServiceRoleDb, reserveBraveSearch } from '@/db/brave-quota'
import { scanEnabled } from '../../lib/features'
import { CANDIDATE_FETCH_TIMEOUT_MS, proposePlan, type PlanDeps } from '../../lib/plan-orchestration'

// The P3-5 server route. Same gate as /api/identify: scan on, a billable provider or Brave key
// configured, the invite/limit reservation, and the per-instance/durable counters. Manual mode
// (no key, no provider) just falls through to general guidance for dishwashers, or returns an
// empty plan for other appliances (KEE-60). The route writes a `plan_search` funnel event
// (counts only, no document text) so the team can see how the search went.

import type { SourceType } from '@/domain/model'
import type { EvidenceLevel } from '@/domain/evidence'
import type { IntervalUnit } from '@/domain/format-interval'

// Funnel event added in KEE-42. The migration's check constraint is updated in the same change set.
// KEE-60: 'no_plan' is returned when the appliance is not a dishwasher and the search yielded
// nothing — the UI shows a plain "no plan could be built" message with the manual-entry form.
export type PlanSearchOutcome = 'ok' | 'no_results' | 'quota_exhausted' | 'fetch_failed' | 'extraction_unavailable' | 'unreadable' | 'no_text' | 'timeout' | 'no_plan'

export type PlanProposalJson = {
  name: string
  instructions: string
  interval: { count: number; unit: IntervalUnit }
  evidenceLevel: EvidenceLevel
  source: {
    type: SourceType
    title: string
    url: string | null
    location: string | null
    quote: string | null
    coveredModel?: string
  }
}

export type PlanResponse = {
  proposals: PlanProposalJson[]
  fallback: 'exact' | 'similar' | 'general'
  searchOutcome: PlanSearchOutcome
  // The orchestration's existing reason, when it has one. The entry screen uses this to
  // choose an honest recovery message. Null when the search itself succeeded.
  searchReason: string | null
}

const PLAN_TIMEOUT_MS = 25_000

// Builds a serialisable TaskProposal (Date-free, plain values). The route hands them to the
// browser exactly as the source-of-truth for Accept / Reject.
function toJsonProposal(p: {
  name: string
  instructions: string
  interval: { count: number; unit: string }
  evidenceLevel: string
  source: { type: string; title: string; url: string | null; location: string | null; quote: string | null; coveredModel?: string }
}): PlanResponse['proposals'][number] {
  return {
    name: p.name,
    instructions: p.instructions,
    interval: { count: p.interval.count, unit: p.interval.unit as 'day' | 'week' | 'month' | 'year' },
    evidenceLevel: p.evidenceLevel as 'manufacturer_verified' | 'similar_model' | 'general_guidance',
    source: {
      type: p.source.type as 'manufacturer_manual' | 'manufacturer_website' | 'similar_model_manual' | 'general_guidance',
      title: p.source.title,
      url: p.source.url,
      location: p.source.location,
      quote: p.source.quote,
      ...(p.source.coveredModel ? { coveredModel: p.source.coveredModel } : {}),
    },
  }
}

// The URL alone cannot say which models a document covers. findPlans reads the cover pages for
// the exact model and for a same-family model number. This stub stays empty so a URL can never
// raise the evidence level by itself.
function resolveSourceFromUrl(_url: string): { documentModels: string[]; documentFamily?: string } {
  void _url
  return { documentModels: [] }
}

function buildDeps(args: {
  signal: AbortSignal
  manufacturerDomains: ManufacturerDomainMap
  env: Record<string, string | undefined>
}): PlanDeps {
  return {
    reserveBraveSearch: async () => {
      const db = createServiceRoleDb(args.env)
      if (!db) return 'allowed' // No Supabase: treat the durable counter as a no-op so a local dev
      // environment without Supabase still reaches the search code path. The per-process Brave
      // cap (KEE-50) and the SQL function together enforce the quota in production.
      return reserveBraveSearch(db)
    },
    searchManuals: ({ manufacturer, model }) => searchManuals({ manufacturer, model }),
    fetchDocument: (url) => fetchDocument(url, undefined, { timeoutMs: CANDIDATE_FETCH_TIMEOUT_MS }),
    extractPages: (bytes, type) => extractPages(bytes, type),
    extractTasks: ({ model, pages }) => {
      // MiniMax is the only implemented AI provider. The route lets it read the manual pages.
      // Manual is also reached by the orchestration's Manual fallback path (no model key set).
      const provider = selectProvider({ env: args.env })
      if (provider.kind === 'manual') return Promise.resolve('unavailable')
      return provider.extractTasks({ model, pages }).catch(() => 'unavailable' as const)
    },
    resolveSource: resolveSourceFromUrl,
    manufacturerDomains: args.manufacturerDomains,
    generalGuidance: () => GENERAL_DISHWASHER_TASKS,
    candidateTitle: (url) => {
      try {
        return new URL(url).pathname.split('/').pop() || url
      } catch {
        return url
      }
    },
    aiModel: args.env.MINIMAX_MODEL?.trim() || 'MiniMax-M3',
    signal: args.signal,
  }
}

// CFO daily report. Reads the durable counter; counts only. The dashboard does not call this in
// production yet, but the function exists so the orchestration's pre-check is observable.
export async function getBraveDailyUsage(env: Record<string, string | undefined> = process.env): Promise<{ used: number; cap: number; monthStart: string } | null> {
  const db = createServiceRoleDb(env)
  if (!db) return null
  return braveQuotaStatus(db)
}

export type PlanRequest = { manufacturer: string; model: string; modelFamily?: string; applianceType?: string | null }

// The single entry point the route handler calls. Separated so tests can drive the same code path
// without a real Supabase.
// KEE-60: the applianceType is forwarded to the orchestration so non-dishwashers do not get the
// general-guidance fallback when the search yields nothing.
export async function runPlan(
  request: PlanRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<PlanResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS)
  try {
    const outcome = await proposePlan(
      {
        manufacturer: request.manufacturer,
        model: request.model,
        modelFamily: request.modelFamily,
        applianceType: request.applianceType,
      },
      buildDeps({
        signal: controller.signal,
        manufacturerDomains: buildDefaultManufacturerDomains(),
        env,
      }),
    )
    return {
      proposals: outcome.proposals.map(toJsonProposal),
      fallback: outcome.fallback,
      searchOutcome: outcome.searchOutcome,
      // Saved plans already classify from searchOutcome. The reason is only needed when
      // there is nothing to save, so an existing dishwasher fallback banner stays as it is.
      searchReason: outcome.proposals.length === 0 ? outcome.searchReason : null,
    }
  } finally {
    clearTimeout(timer)
  }
}

// True when a billable external call would happen: a Brave key, or a non-Manual AI provider.
// Mirrors `aiScanLive` for the identify route, but for the plan-search step.
export function planSearchLive(env: Record<string, string | undefined> = process.env): boolean {
  if (!scanEnabled(env.NEXT_PUBLIC_KEEPLY_SCAN)) return false
  if (env.BRAVE_SEARCH_API_KEY?.trim()) return true
  return selectProvider({ env }).kind !== 'manual'
}

// Reads a funnel event into Supabase when the caller is authenticated. Counts only. No-ops when
// the visitor is signed out (the route's plan_proposed event is the user-facing one; this one is
// for the team). Service-role bypasses RLS so we can record without a per-user client.
export async function recordPlanSearch(
  outcome: PlanSearchOutcome,
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  void env
  const db = createServiceRoleDb()
  if (!db) return
  try {
    await db.from('funnel_events').insert({ name: 'plan_search', props: { outcome } })
  } catch {
    // Funnel events must never break the product flow.
  }
}