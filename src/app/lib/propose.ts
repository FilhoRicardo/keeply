import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { Appliance, TaskProposal } from '@/domain/model'

// Finds the maintenance plan for a confirmed dishwasher. Today: general dishwasher guidance.
// Phase 3 replaces it with manual search (docs/HANDOFF.md §23), falling back to this.
export type PlanProposer = (appliance: Pick<Appliance, 'manufacturer' | 'model'>) => Promise<TaskProposal[]>

export const generalGuidanceProposer: PlanProposer = async () => [...GENERAL_DISHWASHER_TASKS]
