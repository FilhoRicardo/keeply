import 'server-only'
import { buildDefaultManufacturerDomains, type ManufacturerDomainMap } from '@/search/rank'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import { selectProvider } from '@/ai/provider'
import { searchManuals } from '@/search/brave'
import { fetchDocument } from '@/search/fetch-document'
import { extractPages } from '@/search/extract-pages'
import { braveQuotaStatus, createServiceRoleDb, reserveBraveSearch } from '@/db/brave-quota'
import { scanEnabled } from '../../lib/features'
import { proposePlan, type PlanDeps } from '../../lib/plan-orchestration'

// The P3-5 server route. Same gate as /api/identify: scan on, a billable provider or Brave key
// configured, the invite/limit reservation, and the per-instance/durable counters. Manual mode
// (no key, no provider) just falls through to general guidance. The route writes a `plan_search`
// funnel event (counts only, no document text) so the team can see how the search went.

import type { SourceType } from '@/domain/model'
import type { EvidenceLevel } from '@/domain/evidence'
import type { IntervalUnit } from '@/domain/format-interval'

// Funnel event added in KEE-42. The migration's check constraint is updated in the same change set.
export type PlanSearchOutcome = 'ok' | 'no_results' | 'quota_exhausted' | 'fetch_failed' | 'extraction_unavailable' | 'unreadable' | 'no_text' | 'timeout'

export type PlanProposalJson = {
  name: string
  instructions: string
  interval: { count: number; unit: IntervalUnit }
  evidenceLevel: EvidenceLevel
  source: { type: SourceType; title: string; url: string | null; location: string | null; quote: string | null }
}

export type PlanResponse = {
  proposals: PlanProposalJson[]
  fallback: 'exact' | 'similar' | 'general'
  searchOutcome: PlanSearchOutcome
}

const PLAN_TIMEOUT_MS = 25_000

// Builds a serialisable TaskProposal (Date-free, plain values). The route hands them to the
// browser exactly as the source-of-truth for Accept / Reject.
function toJsonProposal(p: {
  name: string
  instructions: string
  interval: { count: number; unit: string }
  evidenceLevel: string
  source: { type: string; title: string; url: string | null; location: string | null; quote: string | null }
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
    },
  }
}

// Best-effort source metadata. The first manual page is usually the cover, and "this document
// applies to the SMS6 family" is on the cover; we keep the model list + family conservative so we
// never over-promise Manufacturer verified (classifyEvidence is the final authority).
//
// The orchestration does not parse PDFs here; the model extraction is. The model family mapping
// is owned by the manual-search adapter that will arrive in a later KEE (Phase 3 P3-3 metadata).
// For the KEE-42 milestone we keep the resolver a no-op so every candidate is at most
// 'similar_model' or 'general_guidance' unless the manual itself names the model — which the AI
// extraction step will see in the page text. classifyEvidence reads `documentModels` from this
// call and the model extraction from the page text.
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
    fetchDocument: (url) => fetchDocument(url),
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

export type PlanRequest = { manufacturer: string; model: string; modelFamily?: string }

// The single entry point the route handler calls. Separated so tests can drive the same code path
// without a real Supabase.
export async function runPlan(
  request: PlanRequest,
  env: Record<string, string | undefined> = process.env,
): Promise<PlanResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS)
  try {
    const outcome = await proposePlan(
      { manufacturer: request.manufacturer, model: request.model, modelFamily: request.modelFamily },
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