import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { Appliance, ProposalMeta, TaskProposal } from '@/domain/model'
import { createApiPlanProposer, type LiveProposalResult } from './api-plan-proposer'

// Finds the maintenance plan for a confirmed appliance. KEE-60: any household appliance, not
// only dishwashers. The dishwashers-only general-guidance list is the honest fallback for
// dishwashers when no manual was found; for every other appliance an empty plan with a
// 'no_plan' outcome is returned unless the live search yielded tasks. The owner can still type
// the manual-entry form when no plan was found.
//
// The default `livePlanProposer` calls /api/plan (KEE-42) and returns both the proposals and
// the outcome (fallback, searchOutcome, searchReason) so the plan page can render an honest
// "looking for your manual" / "we could not find a manual" message. When the route is
// disabled, the visitor is refused, or the search returns nothing:
//   - for dishwashers: fall back to general-guidance proposals.
//   - for everything else: fall back to an empty plan with outcome 'no_plan', so the UI
//     shows the manual-entry path (owner decision, KEE-59; KEE-60).
// `generalGuidanceProposer` is the local, network-free fallback used by tests and older
// deployments.

export type PlanProposer = (
  appliance: Pick<Appliance, 'manufacturer' | 'model'> & { category?: string | null },
  session?: { accessToken?: () => Promise<string | null> },
) => Promise<TaskProposal[] | LivePlanProposerResult>

export type LivePlanProposerResult = {
  proposals: TaskProposal[]
  meta: ProposalMeta
}

const isDishwasher = (category: string | null | undefined): boolean =>
  typeof category === 'string' && category.trim().toLowerCase() === 'dishwasher'

// KEE-43 + KEE-60: the live proposer is now the default. It returns the proposals and the
// `proposalMeta` (fallback + searchOutcome + searchReason + searched flag) that the plan
// page reads from the record.
export const livePlanProposer: PlanProposer = async ({ manufacturer, model: applianceModel, category }, session) => {
  const result = await callLive(
    { manufacturer: manufacturer.trim(), model: applianceModel?.trim() || null, applianceType: category },
    session?.accessToken,
  )
  // Dishwashers: existing behaviour — fall back to general guidance so the plan screen still
  // renders and the owner can still decide.
  if (isDishwasher(category)) {
    if (result.proposals.length > 0) {
      return { proposals: result.proposals, meta: toMeta(result) }
    }
    return {
      proposals: [...GENERAL_DISHWASHER_TASKS],
      meta: toMeta(result),
    }
  }
  // Any other appliance: keep whatever the live search found; never invent dishwasher tasks.
  // An empty plan keeps the outcome the route already returned so the entry screen can say
  // why, instead of replacing it with a generic "no manual" result.
  return { proposals: result.proposals, meta: toMeta(result) }
}

function toMeta(result: LiveProposalResult): ProposalMeta {
  return {
    fallback: result.outcome.fallback,
    searchOutcome: result.outcome.searchOutcome,
    searchReason: result.outcome.searchReason,
    searched: result.searched,
    ...(result.outcome.manualUrl ? { manualUrl: result.outcome.manualUrl } : {}),
  }
}

// The legacy, network-free proposer. Kept for the existing tests and for offline use.
// KEE-60: now requires a category. Dishwashers get general guidance; everything else gets an
// empty plan (consistent with the live proposer above).
export const generalGuidanceProposer: PlanProposer = async ({ category }) =>
  isDishwasher(category) ? [...GENERAL_DISHWASHER_TASKS] : []

// A package-private helper for tests and for callers that want the raw outcome.
export async function callLive(
  input: { manufacturer: string; model: string | null; applianceType?: string | null },
  accessToken?: () => Promise<string | null>,
): Promise<LiveProposalResult> {
  const propose = createApiPlanProposer({ accessToken })
  return propose(input)
}
