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
const GAP = '(?:[\\s-]+)'

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

// A count of occurrences per unit, when { count, unit } can say it exactly.
// Twice a year is every 6 months. Twice a month is every 2 weeks.
// Twice a week, N times per day, and three times a month are null: the interval
// type cannot express them, and rounding would misquote the manual.
function expressTimesPer(count: number, unit: IntervalUnit): Interval | null {
  if (count === 1) return { count: 1, unit }
  if (unit === 'year' && 12 % count === 0) return { count: 12 / count, unit: 'month' }
  if (unit === 'month' && count === 2) return { count: 2, unit: 'week' }
  return null
}

// 'unexpressed' is a real frequency the interval type cannot store.
type ParsedInterval = Interval | 'unexpressed'

type CadencePattern = {
  source: string
  interval: (match: RegExpMatchArray) => ParsedInterval | null
}

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
  {
    source: `\\bevery${GAP}other${GAP}${UNIT}\\b`,
    interval: (match) => {
      const unit = unitOf(match[1] ?? '')
      return unit ? { count: 2, unit } : null
    },
  },
  {
    source: `\\b(once|twice)${GAP}(?:a|per)${GAP}${UNIT}\\b`,
    interval: (match) => {
      const unit = unitOf(match[2] ?? '')
      if (unit === null) return null
      const count = match[1]?.toLowerCase() === 'twice' ? 2 : 1
      return expressTimesPer(count, unit) ?? 'unexpressed'
    },
  },
  {
    source: `\\b${NUMBER}${GAP}times?${GAP}(?:a|per)${GAP}${UNIT}\\b`,
    interval: (match) => {
      const count = parseCount(match[1] ?? '')
      const unit = unitOf(match[2] ?? '')
      if (count === null || unit === null) return null
      return expressTimesPer(count, unit) ?? 'unexpressed'
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
  { source: '\\bfortnightly\\b', interval: () => ({ count: 2, unit: 'week' }) },
  { source: `\\bevery${GAP}fortnight\\b`, interval: () => ({ count: 2, unit: 'week' }) },
  { source: '\\bquarterly\\b', interval: () => ({ count: 3, unit: 'month' }) },
  { source: '\\bhalf(?:[\\s-]*)yearly\\b', interval: () => ({ count: 6, unit: 'month' }) },
  { source: '\\bsemi(?:[\\s-]*)annually\\b', interval: () => ({ count: 6, unit: 'month' }) },
  // "Biannually" means twice a year or every two years. Mapped to every 6 months
  // until Ricardo confirms (RF-347).
  { source: '\\bbi(?:[\\s-]*)annually\\b', interval: () => ({ count: 6, unit: 'month' }) },
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

function earliestCadence(quote: string): CadenceReading | null {
  let best: { index: number; reading: CadenceReading } | null = null
  for (const pattern of CADENCE_PATTERNS) {
    for (const match of quote.matchAll(new RegExp(pattern.source, 'gi'))) {
      const parsed = pattern.interval(match)
      if (!parsed) continue
      const index = match.index ?? 0
      if (best && index >= best.index) continue
      const reading: CadenceReading =
        parsed === 'unexpressed'
          ? { stated: false, wording: match[0].replace(/\s+/g, ' ') }
          : { stated: true, interval: parsed }
      best = { index, reading }
    }
  }
  return best?.reading ?? null
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

// A stated time cadence, or "not stated" plus the manual's own wording.
// When several cadences appear, the one earliest in the quote is used.
// A frequency the interval cannot express is "not stated", with that phrase quoted.
// A usage phrase is preferred over a vague word when the quote has no cadence.
export function readCadence(quote: string): CadenceReading {
  return (
    earliestCadence(quote) ?? {
      stated: false,
      wording: earliestPhrase(quote, USAGE_PATTERNS) ?? earliestPhrase(quote, VAGUE_PATTERNS),
    }
  )
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
