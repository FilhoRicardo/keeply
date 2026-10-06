import type { Source, TaskProposal } from './model'

// KEE-60: the only hand-curated general-guidance list. Dishwashers only. Other appliances show
// an honest "no plan could be built" message unless a manufacturer manual was located. The list
// is kept here (not in plan-orchestration) so a no-AI deployment still has something to render
// for dishwashers and the migration's evidence_supported check stays unchanged.
export const GENERAL_DISHWASHER_SOURCE: Source = {
  type: 'general_guidance',
  title: 'Keeply general dishwasher maintenance guidance',
  url: null,
  location: null,
  quote: null,
}

export const GENERAL_DISHWASHER_TASKS: readonly TaskProposal[] = [
  {
    name: 'Clean the filter',
    instructions:
      'Twist out the filter at the bottom of the tub, rinse it under warm water and brush off food residue, then lock it back in place.',
    interval: { count: 1, unit: 'month' },
    evidenceLevel: 'general_guidance',
    source: GENERAL_DISHWASHER_SOURCE,
  },
  {
    name: 'Run a cleaning cycle',
    instructions:
      'Run the hottest programme empty with a dishwasher cleaner to clear grease and limescale from the tub and pipes.',
    interval: { count: 1, unit: 'month' },
    evidenceLevel: 'general_guidance',
    source: GENERAL_DISHWASHER_SOURCE,
  },
  {
    name: 'Check the spray arms',
    instructions:
      'Remove the spray arms, check they spin freely and clear any blocked holes with a toothpick, then refit them.',
    interval: { count: 3, unit: 'month' },
    evidenceLevel: 'general_guidance',
    source: GENERAL_DISHWASHER_SOURCE,
  },
]
