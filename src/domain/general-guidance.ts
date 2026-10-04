import type { Source, TaskProposal } from './model'

// Used when no manufacturer guidance was found for the model. Honestly General guidance:
// never present these as verified.
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
