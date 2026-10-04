import type { Appliance, Recommendation, SourceDocument } from './model'

// Phase 1 stand-in for evidence retrieval. A manually entered dishwasher has had no model
// lookup, so these are honestly General guidance: never present them as verified.
export const GENERAL_DISHWASHER_GUIDANCE: SourceDocument = {
  id: 'keeply-general-dishwasher-v1',
  sourceType: 'general_guidance',
  title: 'Keeply general dishwasher maintenance guidance',
  reference: null,
  manufacturer: null,
  modelScope: 'All dishwashers',
}

const TEMPLATES = [
  {
    key: 'clean-filter',
    taskName: 'Clean the filter',
    description:
      'Twist out the filter at the bottom of the tub, rinse it under warm water and brush off food residue, then lock it back in place.',
    recommendedInterval: { count: 1, unit: 'month' },
  },
  {
    key: 'cleaning-cycle',
    taskName: 'Run a cleaning cycle',
    description:
      'Run the hottest programme empty with a dishwasher cleaner to clear grease and limescale from the tub and pipes.',
    recommendedInterval: { count: 1, unit: 'month' },
  },
  {
    key: 'spray-arms',
    taskName: 'Check the spray arms',
    description:
      'Remove the spray arms, check they spin freely and clear any blocked holes with a toothpick, then refit them.',
    recommendedInterval: { count: 3, unit: 'month' },
  },
] as const

export function mockRecommendations(appliance: Pick<Appliance, 'id'>): Recommendation[] {
  return TEMPLATES.map((t) => ({
    id: `${appliance.id}:${t.key}`,
    applianceId: appliance.id,
    taskName: t.taskName,
    description: t.description,
    recommendedInterval: { ...t.recommendedInterval },
    evidenceLevel: 'general_guidance',
    source: GENERAL_DISHWASHER_GUIDANCE,
    sourceLocation: null,
  }))
}
