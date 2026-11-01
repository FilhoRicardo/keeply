import { MAX_SOURCE_QUOTE_LENGTH, MIN_QUOTE_LENGTH, verifyQuote } from './evidence-check'
import type { Interval, IntervalUnit } from './format-interval'
import { formatInterval } from './format-interval'
import { normalizeText } from './normalize'

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
  '\\bwhen (?:the )?indicator\\b',
  '\\bindicator (?:is )?(?:on|lit)\\b',
  '\\bindicators? show\\b',
]

const INDICATOR_PATTERNS = [
  '\\bwhen (?:the )?indicator\\b',
  '\\bindicator (?:is )?(?:on|lit)\\b',
  '\\bindicators? show\\b',
]

function isRefillMaintenance(text: string): boolean {
  return /\b(refill|top up|top-up|fill|replenish|keep)\b/i.test(text) && /\b(salt|rinse[\s-]*aid)\b/i.test(text)
}

/** Previous bullet/sentence carries a schedule that applies to the current maintenance line (e.g. Machine Care). */
export function adjacentScheduleApplies(previous: string, current: string): boolean {
  if (!/\bmachine\s+care\b/.test(current)) return false
  return (
    /\b(cleaning product|descaler|dishwashers)\b/.test(previous) &&
    (readCadence(previous).stated || /\bat least once every\b/.test(previous))
  )
}

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
  const indicatorWording = earliestPhrase(quote, INDICATOR_PATTERNS)
  const cadence = earliestCadence(quote)
  if (cadence?.stated && indicatorWording && isRefillMaintenance(quote)) {
    if (cadence.interval.count === 1 && cadence.interval.unit === 'day') {
      return { stated: false, wording: indicatorWording }
    }
  }
  return (
    cadence ?? {
      stated: false,
      wording:
        indicatorWording ??
        earliestPhrase(quote, USAGE_PATTERNS) ??
        earliestPhrase(quote, VAGUE_PATTERNS),
    }
  )
}

/** Bullet or sentence segments that may carry the schedule phrase for this quote. */
export function cadenceContextSegments(pageText: string, quote: string): string[] {
  const doc = normalizeText(pageText)
  const q = normalizeText(quote)
  if (q.length < MIN_QUOTE_LENGTH) return [quote]

  const bullets = pageText
    .split(/\s*•\s*/)
    .map((part) => normalizeText(part))
    .filter(Boolean)
  for (let i = 0; i < bullets.length; i += 1) {
    const segment = bullets[i] ?? ''
    if (!segment.includes(q)) continue
    const previous = i > 0 ? (bullets[i - 1] ?? '') : ''
    if (previous && adjacentScheduleApplies(previous, segment)) {
      return [segment, `${previous} ${segment}`.replace(/\s+/g, ' ').trim(), previous]
    }
    return [segment]
  }

  const raw = pageText.replace(/\r\n/g, '\n')
  const quoteLine = raw.split('\n').find((line) => normalizeText(line).includes(q))
  if (quoteLine && !quoteLine.includes('•')) {
    return [normalizeText(quoteLine)]
  }

  const sentences = doc.split(/\.\s+/).filter(Boolean)
  for (let i = 0; i < sentences.length; i += 1) {
    const sentence = sentences[i] ?? ''
    if (!sentence.includes(q)) continue
    const previous = i > 0 ? (sentences[i - 1] ?? '') : ''
    if (previous && adjacentScheduleApplies(previous, sentence)) {
      return [sentence, `${previous} ${sentence}`.replace(/\s+/g, ' ').trim(), previous]
    }
    return [sentence]
  }

  const idx = doc.indexOf(q)
  if (idx >= 0) {
    const start = Math.max(0, idx - 120)
    const end = Math.min(doc.length, idx + q.length + 40)
    return [doc.slice(start, end)]
  }
  return [quote]
}

// Reads cadence from the quote, then from the manual bullet/sentence that contains it.
export function readCadenceFromContext(quote: string, pageText?: string | null): CadenceReading {
  const inQuote = readCadence(quote)
  if (inQuote.stated || !pageText?.trim()) return inQuote
  if (isRefillMaintenance(quote) && earliestPhrase(quote, INDICATOR_PATTERNS)) return inQuote
  const q = normalizeText(quote)
  if (pageText.includes('•')) {
    const bullets = pageText
      .split(/\s*•\s*/)
      .map((part) => normalizeText(part))
      .filter(Boolean)
    let matchIndex = -1
    for (let i = 0; i < bullets.length; i += 1) {
      if (bullets[i]?.includes(q)) matchIndex = i
    }
    if (matchIndex >= 0) {
      const current = bullets[matchIndex] ?? ''
      const fromCurrent = readCadence(current)
      if (fromCurrent.stated) return fromCurrent
      if (matchIndex > 0) {
        const previous = bullets[matchIndex - 1] ?? ''
        if (adjacentScheduleApplies(previous, current)) {
          const merged = `${previous} ${current}`.replace(/\s+/g, ' ').trim()
          const fromMerged = readCadence(merged)
          if (fromMerged.stated) return fromMerged
        }
      }
    }
    return inQuote
  }
  for (const segment of cadenceContextSegments(pageText, quote)) {
    const reading = readCadence(segment)
    if (reading.stated) return reading
  }
  return inQuote
}

function cadenceSpanInQuote(quote: string): string | null {
  for (const pattern of CADENCE_PATTERNS) {
    for (const match of quote.matchAll(new RegExp(pattern.source, 'gi'))) {
      const parsed = pattern.interval(match)
      if (!parsed || parsed === 'unexpressed') continue
      return match[0].replace(/\s+/g, ' ')
    }
  }
  return null
}

function longestVerifiedWordPrefix(
  quote: string,
  pageText: string,
  maxLen: number,
  mustContain: string | null,
): string | null {
  const words = quote.trim().split(/\s+/).filter(Boolean)
  const need = mustContain ? normalizeText(mustContain) : null
  for (let n = words.length; n >= 1; n -= 1) {
    const candidate = words.slice(0, n).join(' ')
    if (candidate.length > maxLen || candidate.trim().length === 0) continue
    if (need && !normalizeText(candidate).includes(need)) continue
    if (verifyQuote(pageText, candidate)) return candidate
  }
  return null
}

/** Keeps quotes within the DB limit while staying a verified page substring. */
export function fitSourceQuoteForStorage(widened: string, pageText: string, original: string): string {
  const max = MAX_SOURCE_QUOTE_LENGTH
  const fits = (q: string) => q.length <= max && q.trim().length > 0 && verifyQuote(pageText, q)

  if (fits(widened)) return widened

  const cadence = cadenceSpanInQuote(widened)
  const shrunkWidened = longestVerifiedWordPrefix(widened, pageText, max, cadence)
  if (shrunkWidened) return shrunkWidened

  if (fits(original)) return original
  const shrunkOriginal = longestVerifiedWordPrefix(original, pageText, max, null)
  if (shrunkOriginal) return shrunkOriginal
  return original.trim().slice(0, max).trim()
}

// When the model quote omits the schedule phrase, widen to a verified page span that includes it.
export function quoteWithPageCadence(quote: string, pageText: string): string {
  const original = quote.trim()
  if (readCadence(original).stated) return fitSourceQuoteForStorage(original, pageText, original)
  const q = normalizeText(quote)
  const raw = pageText.replace(/\r\n/g, '\n')
  const lines = raw.split('\n').filter((line) => line.trim().length > 0)
  if (lines.length > 1) {
    const quoteLine = lines.find((line) => normalizeText(line).includes(q))
    if (quoteLine) return fitSourceQuoteForStorage(original, pageText, original)
  }
  if (pageText.includes('•')) {
  const bullets = pageText
    .split(/\s*•\s*/)
    .map((part) => normalizeText(part))
    .filter(Boolean)
  for (let i = 0; i < bullets.length; i += 1) {
    const current = bullets[i] ?? ''
    if (!current.includes(q)) continue
    const cleaned = current.replace(/\s+/g, ' ').trim()
    if (readCadence(cleaned).stated && verifyQuote(pageText, cleaned)) {
      return fitSourceQuoteForStorage(cleaned, pageText, original)
    }
    if (i > 0) {
      const previous = bullets[i - 1] ?? ''
      if (adjacentScheduleApplies(previous, cleaned)) {
        const merged = `${previous} ${cleaned}`.replace(/\s+/g, ' ').trim()
        if (readCadence(merged).stated && verifyQuote(pageText, merged)) {
          return fitSourceQuoteForStorage(merged, pageText, original)
        }
      }
    }
    break
  }
  }
  for (const segment of cadenceContextSegments(pageText, quote)) {
    if (!readCadence(segment).stated) continue
    const cleaned = segment.replace(/\s+/g, ' ').trim()
    if (cleaned.length >= MIN_QUOTE_LENGTH && verifyQuote(pageText, cleaned)) {
      return fitSourceQuoteForStorage(cleaned, pageText, original)
    }
  }
  return fitSourceQuoteForStorage(original, pageText, original)
}

export type IntervalPresentation = { interval: Interval; text: string }

// The interval and "how often" line for a task. Manual-derived tasks are recomputed
// from the stored quote, so a saved plan cannot show an invented cadence as the manual's.
// Built-in general guidance keeps the interval it was written with.
export function presentInterval(input: {
  quote: string | null
  stored: Interval
  generalGuidance: boolean
  pageText?: string | null
}): IntervalPresentation {
  if (input.generalGuidance) return { interval: input.stored, text: formatInterval(input.stored) }
  const reading = readCadenceFromContext(input.quote ?? '', input.pageText)
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
