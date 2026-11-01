import type { TaskProposal } from '@/domain/model'

// KEE-43: the live proposer that calls /api/plan. The plan screen uses the cached outcome
// (searchOutcome + fallback) to render the "looking for your manual" progress, the fallback
// banner when no manufacturer manual was found, and the honest source details on every task.
//
// The /api/plan route is only enabled when scan is on AND a billable provider is configured
// (a non-Manual AI provider or a Brave key). When the route is disabled, the proposer falls
// back to the general-guidance path so the plan screen still renders. This is the same
// fallback /api/plan uses internally; surfacing it here lets the UI say "we did not search"
// vs. "we searched and found nothing".

export type ProposalOutcome = {
  fallback: 'exact' | 'similar' | 'general'
  // Mirrors the API's `searchOutcome`: 'ok' when the chain produced verified/similar-model
  // tasks, otherwise the reason the search did not yield a better plan.
  searchOutcome:
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
    | 'unavailable'
    | 'no_plan'
  // Optional human-readable reason, e.g. the Brave search reason or a missing key.
  searchReason: string | null
  manualUrl?: string | null
}

export type LiveProposalResult = {
  proposals: TaskProposal[]
  outcome: ProposalOutcome
  // True when the route was reachable and the search actually ran. False when the route is
  // disabled, the visitor is signed out, or any pre-flight refusal was returned.
  searched: boolean
}

export type ApiPlanProposerOptions = {
  fetch?: typeof fetch
  now?: () => Date
  // The visitor's session token. /api/plan refuses to search without one.
  accessToken?: () => Promise<string | null>
}

const DEFAULT_OUTCOME: ProposalOutcome = {
  fallback: 'general',
  searchOutcome: 'unavailable',
  searchReason: 'plan_search_disabled',
}

// The plan API takes a JSON body. Models are validated server-side. Empty model is allowed
// (the orchestration falls back to general guidance in that case).
async function postPlan(
  body: { manufacturer: string; model: string | null; applianceType?: string | null },
  fetcher: typeof fetch,
  token: string | null,
): Promise<Response> {
  const applianceType = typeof body.applianceType === 'string' ? body.applianceType.trim() : ''
  return fetcher('/api/plan', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      manufacturer: body.manufacturer,
      model: body.model ?? '',
      ...(applianceType ? { applianceType } : {}),
    }),
  })
}

function asOutcome(input: unknown): ProposalOutcome {
  if (!input || typeof input !== 'object') return DEFAULT_OUTCOME
  const o = input as Record<string, unknown>
  const fallback = o.fallback === 'exact' || o.fallback === 'similar' ? o.fallback : 'general'
  const raw = typeof o.searchOutcome === 'string' ? o.searchOutcome : 'unavailable'
  const searchOutcome = (
    [
      'ok',
      'no_results',
      'search_error',
      'search_empty',
      'manual_found_ai_no_tasks',
      'quota_exhausted',
      'fetch_failed',
      'extraction_unavailable',
      'unreadable',
      'no_text',
      'timeout',
      'unavailable',
      'no_plan',
    ] as const
  ).includes(raw as ProposalOutcome['searchOutcome'])
    ? (raw as ProposalOutcome['searchOutcome'])
    : 'unavailable'
  return {
    fallback,
    searchOutcome,
    searchReason: typeof o.searchReason === 'string' ? o.searchReason : null,
    manualUrl: typeof o.manualUrl === 'string' ? o.manualUrl : null,
  }
}

function asProposals(input: unknown): TaskProposal[] {
  if (!Array.isArray(input)) return []
  return input
    .map((row): TaskProposal | null => {
      if (!row || typeof row !== 'object') return null
      const r = row as Record<string, unknown>
      const interval = r.interval as { count?: unknown; unit?: unknown } | null
      const source = r.source as Record<string, unknown> | null
      if (!interval || typeof interval.count !== 'number' || typeof interval.unit !== 'string') return null
      if (!source) return null
      if (
        typeof r.name !== 'string' ||
        typeof r.instructions !== 'string' ||
        typeof r.evidenceLevel !== 'string'
      ) {
        return null
      }
      const evidenceLevel = (
        ['manufacturer_verified', 'similar_model', 'general_guidance'] as const
      ).includes(r.evidenceLevel as TaskProposal['evidenceLevel'])
        ? (r.evidenceLevel as TaskProposal['evidenceLevel'])
        : 'general_guidance'
      const sourceType = source.type as TaskProposal['source']['type']
      if (
        sourceType !== 'manufacturer_manual' &&
        sourceType !== 'manufacturer_website' &&
        sourceType !== 'similar_model_manual' &&
        sourceType !== 'general_guidance'
      ) {
        return null
      }
      return {
        name: r.name,
        instructions: r.instructions,
        interval: { count: interval.count as number, unit: interval.unit as TaskProposal['interval']['unit'] },
        evidenceLevel,
        source: {
          type: sourceType,
          title: typeof source.title === 'string' ? source.title : '',
          url: typeof source.url === 'string' ? source.url : null,
          location: typeof source.location === 'string' ? source.location : null,
          quote: typeof source.quote === 'string' ? source.quote : null,
          ...(typeof source.coveredModel === 'string' && source.coveredModel.trim()
            ? { coveredModel: source.coveredModel.trim() }
            : {}),
        },
      }
    })
    .filter((p): p is TaskProposal => p !== null)
}

export function createApiPlanProposer(opts: ApiPlanProposerOptions = {}): (appliance: {
  manufacturer: string
  model: string | null
  applianceType?: string | null
}) => Promise<LiveProposalResult> {
  const fetcher = opts.fetch ?? fetch
  return async ({ manufacturer, model, applianceType }) => {
    try {
      const token = await opts.accessToken?.().catch(() => null)
      const response = await postPlan({ manufacturer, model, applianceType }, fetcher, token ?? null)
      if (response.status === 404 || response.status === 403) {
        // The route is disabled or the visitor was refused. Fall back to general guidance
        // without claiming we searched.
        const reason = response.status === 404 ? 'plan_search_disabled' : 'plan_search_refused'
        return {
          proposals: [],
          outcome: { fallback: 'general', searchOutcome: 'unavailable', searchReason: reason },
          searched: false,
        }
      }
      if (!response.ok) {
        return {
          proposals: [],
          outcome: { fallback: 'general', searchOutcome: 'unavailable', searchReason: `http_${response.status}` },
          searched: false,
        }
      }
      const body = (await response.json()) as { proposals?: unknown; fallback?: unknown; searchOutcome?: unknown; searchReason?: unknown }
      const outcome = asOutcome(body)
      const proposals = asProposals(body.proposals)
      return { proposals, outcome, searched: true }
    } catch {
      // Network failure: treat as a not-searched fallback so the UI can be honest about it.
      return {
        proposals: [],
        outcome: { fallback: 'general', searchOutcome: 'unavailable', searchReason: 'network_error' },
        searched: false,
      }
    }
  }
}

export function fallbackReason(outcome: ProposalOutcome): string {
  if (outcome.searchOutcome === 'ok') return 'no_manual_needed'
  if (outcome.searchOutcome === 'quota_exhausted') return 'quota_exhausted'
  if (outcome.searchReason === 'no_key') return 'no_search_key'
  if (outcome.searchReason === 'plan_search_disabled') return 'plan_search_disabled'
  if (outcome.searchReason === 'plan_search_refused') return 'plan_search_refused'
  if (outcome.searchReason === 'network_error') return 'network_error'
  return outcome.searchOutcome
}
