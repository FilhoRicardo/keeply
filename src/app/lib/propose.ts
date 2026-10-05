import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { Appliance, ProposalMeta, TaskProposal } from '@/domain/model'
import { createApiPlanProposer, type LiveProposalResult } from './api-plan-proposer'

// Finds the maintenance plan for a confirmed dishwasher.
//
// The default `livePlanProposer` calls /api/plan (KEE-42) and returns both the proposals and
// the outcome (fallback, searchOutcome, searchReason) so the plan page can render an honest
// "looking for your manual" / "we could not find a manual" message. When the route is
// disabled, the visitor is refused, or the search returns nothing, it falls back to
// general-guidance proposals. `generalGuidanceProposer` is the local, network-free fallback
// used by tests and older deployments.

export type PlanProposer = (
  appliance: Pick<Appliance, 'manufacturer' | 'model'>,
) => Promise<TaskProposal[] | LivePlanProposerResult>

export type LivePlanProposerResult = {
  proposals: TaskProposal[]
  meta: ProposalMeta
}

// KEE-43: the live proposer is now the default. It returns the proposals and the
// `proposalMeta` (fallback + searchOutcome + searchReason + searched flag) that the plan
// page reads from the record.
export const livePlanProposer: PlanProposer = async ({ manufacturer, model }) => {
  const result = await callLive({ manufacturer: manufacturer.trim(), model: model?.trim() || null })
  if (result.proposals.length > 0) {
    return { proposals: result.proposals, meta: toMeta(result) }
  }
  // Either the route is disabled, the search yielded nothing, or something failed. Fall back
  // to general guidance so the plan screen still renders and the owner can still decide.
  return {
    proposals: [...GENERAL_DISHWASHER_TASKS],
    meta: toMeta(result),
  }
}

function toMeta(result: LiveProposalResult): ProposalMeta {
  return {
    fallback: result.outcome.fallback,
    searchOutcome: result.outcome.searchOutcome,
    searchReason: result.outcome.searchReason,
    searched: result.searched,
  }
}

// The legacy, network-free proposer. Kept for the existing tests and for offline use.
export const generalGuidanceProposer: PlanProposer = async () => [...GENERAL_DISHWASHER_TASKS]

// A package-private helper for tests and for callers that want the raw outcome.
export async function callLive(input: {
  manufacturer: string
  model: string | null
}): Promise<LiveProposalResult> {
  const propose = createApiPlanProposer()
  return propose(input)
}
