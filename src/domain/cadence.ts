import type { Interval, IntervalUnit } from './format-interval'
import { formatInterval } from './format-interval'

// How often a manual-derived task repeats. Read from the verified quote only.
// A stated cadence is the manual's. Anything else is Keeply's fixed default.
// The model's interval is never an input.

export const KEEPLY_DEFAULT_INTERVAL: Interval = { count: 1, unit: 'month' }

export type CadenceReading = { stated: true; interval: Interval } | { stated: false; wording: string | null }

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
}

const NUMBER = '(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)'
const UNIT = '(day|week|month|year)s?'

const UNITS = new Set<IntervalUnit>(['day', 'week', 'month', 'year'])

function parseCount(raw: string): number | null {
  const word = WORD_NUMBERS[raw.toLowerCase()]
  if (word) return word
  if (!/^\d+$/.test(raw)) return null
  const count = Number(raw)
  if (!Number.isInteger(count) || count < 1) return null
  return count
}

function unitOf(raw: string): IntervalUnit | null {
  const unit = raw.toLowerCase()
  return UNITS.has(unit as IntervalUnit) ? (unit as IntervalUnit) : null
}

type CadencePattern = { source: string; interval: (match: RegExpMatchArray) => Interval | null }

const CADENCE_PATTERNS: readonly CadencePattern[] = [
  {
    source: `\\bevery\\s+${NUMBER}\\s+${UNIT}\\b`,
    interval: (match) => {
      const count = parseCount(match[1] ?? '')
      const unit = unitOf(match[2] ?? '')
      if (count === null || unit === null) return null
      return { count, unit }
    },
  },
  { source: '\\btwice\\s+a\\s+year\\b', interval: () => ({ count: 6, unit: 'month' }) },
  {
    source: '\\bonce\\s+a\\s+(week|month|year)\\b',
    interval: (match) => {
      const unit = unitOf(match[1] ?? '')
      return unit ? { count: 1, unit } : null
    },
  },
  {
    source: '\\bevery\\s+(day|week|month|year)\\b',
    interval: (match) => {
      const unit = unitOf(match[1] ?? '')
      return unit ? { count: 1, unit } : null
    },
  },
  { source: '\\beach\\s+day\\b', interval: () => ({ count: 1, unit: 'day' }) },
  { source: '\\bdaily\\b', interval: () => ({ count: 1, unit: 'day' }) },
  { source: '\\bweekly\\b', interval: () => ({ count: 1, unit: 'week' }) },
  { source: '\\bmonthly\\b', interval: () => ({ count: 1, unit: 'month' }) },
  { source: '\\b(?:yearly|annually)\\b', interval: () => ({ count: 1, unit: 'year' }) },
]

// Usage phrases are not a time cadence. "after each/every use/wash" covers the
// listed "after each use" and "after every wash", plus the same shape with the
// other pairing ("after each wash", "after every use").
const USAGE_PATTERNS = [
  '\\bafter\\s+(?:each|every)\\s+(?:use|wash)\\b',
  `\\bevery\\s+${NUMBER}\\s+(?:washes|cycles|wash|cycle)\\b`,
]

const VAGUE_PATTERNS = [
  '\\bregularly\\b',
  '\\bperiodically\\b',
  '\\bwhen\\s+necessary\\b',
  '\\bif\\s+necessary\\b',
  '\\bfrom\\s+time\\s+to\\s+time\\b',
]

function earliestCadence(quote: string): Interval | null {
  let best: { index: number; interval: Interval } | null = null
  for (const pattern of CADENCE_PATTERNS) {
    for (const match of quote.matchAll(new RegExp(pattern.source, 'gi'))) {
      const interval = pattern.interval(match)
      if (!interval) continue
      const index = match.index ?? 0
      if (!best || index < best.index) best = { index, interval }
    }
  }
  return best?.interval ?? null
}

function earliestPhrase(quote: string, sources: readonly string[]): string | null {
  let best: { index: number; text: string } | null = null
  for (const source of sources) {
    for (const match of quote.matchAll(new RegExp(source, 'gi'))) {
      const index = match.index ?? 0
      if (!best || index < best.index) best = { index, text: match[0].replace(/\s+/g, ' ') }
    }
  }
  return best?.text ?? null
}

// A stated time cadence, or "not stated" plus the manual's own vague or usage wording.
// When several time cadences appear, the one earliest in the quote is used.
// A usage phrase is preferred over a vague word when the quote has both.
export function readCadence(quote: string): CadenceReading {
  const interval = earliestCadence(quote)
  if (interval) return { stated: true, interval }
  return { stated: false, wording: earliestPhrase(quote, USAGE_PATTERNS) ?? earliestPhrase(quote, VAGUE_PATTERNS) }
}

export type IntervalPresentation = { interval: Interval; text: string }

// The interval and "how often" line for a task. Manual-derived tasks are recomputed
// from the stored quote, so a saved plan cannot show an invented cadence as the manual's.
// Built-in general guidance keeps the interval it was written with.
export function presentInterval(input: {
  quote: string | null
  stored: Interval
  generalGuidance: boolean
}): IntervalPresentation {
  if (input.generalGuidance) return { interval: input.stored, text: formatInterval(input.stored) }
  const reading = readCadence(input.quote ?? '')
  if (reading.stated) {
    return { interval: reading.interval, text: `${formatInterval(reading.interval)} · from the manual` }
  }
  const detail = reading.wording
    ? `The manual says "${reading.wording}".`
    : 'The manual does not say how often.'
  return {
    interval: KEEPLY_DEFAULT_INTERVAL,
    text: `${formatInterval(KEEPLY_DEFAULT_INTERVAL)} · Keeply's suggestion. ${detail}`,
  }
}
