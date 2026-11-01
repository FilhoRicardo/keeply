import 'server-only'
import { KEEPLY_DEFAULT_INTERVAL, readCadence } from '@/domain/cadence'
import { extractJsonObject } from './identity'

// One page of a manufacturer manual in the same shape that `src/search/extract-pages` returns.
// The provider layer receives these from the manual search and forwards them to the model.
export type ExtractedPage = {
  page: number
  text: string
}

// One candidate the model proposed while reading a manual. Never trusted on its own: P3-1
// (`verifyQuote` and `classifyEvidence`) decides the evidence level, and the page text decides
// whether the quote is even real. `interval` is only the model's guess. The interval the
// owner sees is decided from the quote by `readCadence` (`src/domain/cadence.ts`).
export type ExtractedTaskCandidate = {
  task: string
  instructions: string
  interval: { count: number; unit: 'day' | 'week' | 'month' | 'year' }
  page: number
  quote: string
}

// What every adapter asks the model for. Kept here so every provider asks the same question.
export const EXTRACTION_INSTRUCTIONS = `You read pages of a household appliance's maintenance manual.
Reply with only one JSON object, no other text:
{"candidates": [{"task": string, "instructions": string, "interval": {"count": number, "unit": "day"|"week"|"month"|"year"}, "page": number, "quote": string}]}
Rules:
- List every recurring owner maintenance task the manual describes (e.g. filter cleaning, spray arms, door gasket or seal care, salt and rinse-aid refills, descaling, and built-in cleaning programmes or cycles such as Machine Care or a maintenance wash). When the manual tells the owner to run a named programme on a schedule, that is its own task. One candidate per distinct maintenance component (one filter task, one spray-arm task, one door/gasket task, one cleaning programme, separate salt and rinse-aid refills when both appear).
- Cadence may be phrased as "at least once every N months/weeks" or with word numbers ("two months"); still extract the task and quote that phrase verbatim.
- Copy the quote VERBATIM from the page text I send you. Never invent or paraphrase a quote. The quote is how a real claim is verified.
- The "page" must be the page number I provided. The quote must appear in that page's text.
- "instructions" is a short summary of what to do, in your own words.
- "interval" is the cadence the manual states (e.g. monthly -> 1, "every 3 months" -> 3). Use unit "day", "week", "month" or "year". When the manual describes a recurring task but does not say how often, use a sensible default interval for the JSON field; the quote must still be verbatim text about the task. When refills depend on an indicator, quote the indicator wording; do not invent a daily schedule.
- A candidate is one proposed task. Skip anything the manual does not state.
- If the pages do not state any maintenance task, return {"candidates": []}.`

const INTERVAL_UNITS = new Set(['day', 'week', 'month', 'year'])

// Cleans one raw model item into a valid candidate, or null when anything is wrong. The model is
// untrusted input: every field is checked. The evidence level is decided elsewhere (P3-1); this
// function does not look at it.
function cleanCandidate(raw: unknown, pageNumbers: ReadonlySet<number>): ExtractedTaskCandidate | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const task = typeof r.task === 'string' ? r.task.trim().replace(/\s+/g, ' ') : ''
  const instructions = typeof r.instructions === 'string' ? r.instructions.trim().replace(/\s+/g, ' ') : ''
  const quote = typeof r.quote === 'string' ? r.quote.trim().replace(/\s+/g, ' ') : ''
  if (!task || task.length > 200) return null
  if (!instructions || instructions.length > 1000) return null
  if (!quote) return null
  const page = typeof r.page === 'number' && Number.isInteger(r.page) ? r.page : NaN
  if (!pageNumbers.has(page)) return null
  const intervalRaw = r.interval as Record<string, unknown> | undefined
  const count = intervalRaw && typeof intervalRaw.count === 'number' && Number.isInteger(intervalRaw.count) ? intervalRaw.count : NaN
  const unit = intervalRaw && typeof intervalRaw.unit === 'string' ? intervalRaw.unit : ''
  if (!Number.isInteger(count) || count < 1 || count > 365) return null
  if (!INTERVAL_UNITS.has(unit)) return null
  const cadence = readCadence(quote, task)
  const interval = cadence.stated ? cadence.interval : KEEPLY_DEFAULT_INTERVAL
  return { task, instructions, quote, page, interval }
}

// Finds the model reply's `candidates` array and returns the cleaned candidates. Drops malformed
// items one by one; never throws and never returns a partial failure. Empty array is the right
// answer when the manual had nothing to extract.
export function normaliseExtraction(raw: unknown, pageNumbers: ReadonlySet<number>): ExtractedTaskCandidate[] {
  if (!raw || typeof raw !== 'object') return []
  const list = (raw as Record<string, unknown>).candidates
  if (!Array.isArray(list)) return []
  const out: ExtractedTaskCandidate[] = []
  for (const item of list) {
    const candidate = cleanCandidate(item, pageNumbers)
    if (candidate) out.push(candidate)
  }
  return out
}

// Convenience for adapters: parse a model reply, including the common cases of the model wrapping
// its JSON in prose or a code fence, and return the cleaned candidates.
export function parseExtractionReply(reply: string, pageNumbers: ReadonlySet<number>): ExtractedTaskCandidate[] {
  const parsed = extractJsonObject(reply)
  if (parsed === null) return []
  return normaliseExtraction(parsed, pageNumbers)
}

export function normalisedTaskName(task: string): string {
  return task.trim().toLowerCase().replace(/\s+/g, ' ')
}

const SPRAY_ARM_PATTERN = /\bspray[\s-]*arms?\b/
const FILTER_COMPONENT_PATTERN = /\bfilters?\b|\bforeign object\b|\bsump\b/

function firstPatternIndex(text: string, pattern: RegExp): number {
  const match = text.match(pattern)
  return match?.index ?? -1
}

function resolveSprayArmVsFilter(text: string): 'spray-arms' | 'filters' | null {
  const sprayIdx = firstPatternIndex(text, SPRAY_ARM_PATTERN)
  const filterIdx = firstPatternIndex(text, FILTER_COMPONENT_PATTERN)
  if (sprayIdx < 0 && filterIdx < 0) return null
  if (sprayIdx >= 0 && filterIdx < 0) return 'spray-arms'
  if (filterIdx >= 0 && sprayIdx < 0) return 'filters'
  return sprayIdx < filterIdx ? 'spray-arms' : 'filters'
}

function maintenanceComponentFromText(text: string): string | null {
  const blob = text.toLowerCase()
  if (/\brinse[\s-]*aid\b/.test(blob)) return 'rinse-aid'
  if (/\bsalt\b/.test(blob)) return 'salt'
  if (
    /\bmachine\s+care\b/.test(blob) ||
    (/\bprogramme\b/.test(blob) && /\b(descaler|cleaning product|internal cleaning)\b/.test(blob))
  ) {
    return 'machine-care'
  }
  if (/\b(door|gasket|rubber)\b/.test(blob) && /\b(wipe|clean|gasket|door|seal)\b/.test(blob)) return 'door-gasket'
  const sprayOrFilter = resolveSprayArmVsFilter(blob)
  if (sprayOrFilter) return sprayOrFilter
  return null
}

/** Deterministic key for the appliance part a maintenance task acts on (for post-merge consolidation). */
export function maintenanceComponentKey(candidate: ExtractedTaskCandidate): string {
  const fromTask = maintenanceComponentFromText(candidate.task)
  if (fromTask) return fromTask
  const fromBody = maintenanceComponentFromText(`${candidate.instructions} ${candidate.quote}`)
  if (fromBody) return fromBody
  return normalisedTaskName(candidate.task)
}

export type MergeExtractedTasksOptions = {
  pageTextByNumber?: ReadonlyMap<number, string>
  readCadence?: (quote: string, pageText?: string, task?: string) => { stated: boolean }
}

function isIndicatorRefillQuote(quote: string): boolean {
  const q = quote.toLowerCase()
  return /\bindicator\b/.test(q) && /\b(refill|top up|fill|replenish|keep)\b/.test(q) && /\b(salt|rinse[\s-]*aid)\b/.test(q)
}

function misalignedDailyForIndicator(candidate: ExtractedTaskCandidate, readCadenceFn: MergeExtractedTasksOptions['readCadence']): boolean {
  const blob = `${candidate.task} ${candidate.quote}`.toLowerCase()
  if (!/\b(refill|top up|fill|replenish|keep)\b/.test(blob)) return false
  if (!/\b(salt|rinse[\s-]*aid)\b/.test(blob)) return false
  if (!/\bindicator\b/.test(blob)) return false
  const stated = readCadenceFn?.(candidate.quote, undefined, candidate.task)?.stated
  return stated === true && /\bevery\s+day\b/i.test(candidate.quote)
}

function refillComponentScoreAdjustments(
  candidate: ExtractedTaskCandidate,
  componentKey: string,
  cadenceStated: boolean,
): number {
  if (componentKey !== 'salt' && componentKey !== 'rinse-aid') return 0
  if (isIndicatorRefillQuote(candidate.quote)) return 45
  if (cadenceStated && !isIndicatorRefillQuote(candidate.quote)) return -160
  return 0
}

function componentPreferenceBonus(candidate: ExtractedTaskCandidate, componentKey: string): number {
  const q = candidate.quote.toLowerCase()
  if (componentKey === 'filters' && q.includes('after each use') && q.includes('sump')) return 30
  if (componentKey === 'filters' && q.includes('filter') && q.includes('regularly')) return 25
  if (componentKey === 'spray-arms' && q.includes('spray arm') && q.includes('regularly')) return 25
  if (componentKey === 'machine-care') {
    if (/\bat least once every two months\b/.test(q)) return 35
    if (/\bevery\s+day\b/.test(q)) return -120
  }
  if (componentKey === 'door-gasket' && q.includes('once a week')) return 20
  return 0
}

function mergeScore(
  candidate: ExtractedTaskCandidate,
  cadenceStated: boolean,
  readCadenceFn: MergeExtractedTasksOptions['readCadence'],
  componentKey?: string,
): number {
  let score = (cadenceStated ? 100 : 0) + Math.min(candidate.quote.length, 500) / 500
  if (misalignedDailyForIndicator(candidate, readCadenceFn)) score -= 150
  if (/\bregularly\b/i.test(candidate.quote) && !cadenceStated) score += 5
  if (componentKey) {
    score += componentPreferenceBonus(candidate, componentKey)
    score += refillComponentScoreAdjustments(candidate, componentKey, cadenceStated)
  }
  return score
}

function pickBetterCandidate(
  a: ExtractedTaskCandidate,
  b: ExtractedTaskCandidate,
  opts: MergeExtractedTasksOptions,
): ExtractedTaskCandidate {
  const readCadenceFn = opts.readCadence ?? (() => ({ stated: false }))
  const pageTextByNumber = opts.pageTextByNumber ?? new Map()
  const pageA = pageTextByNumber.get(a.page)
  const pageB = pageTextByNumber.get(b.page)
  const statedA = readCadenceFn(a.quote, pageA, a.task).stated
  const statedB = readCadenceFn(b.quote, pageB, b.task).stated
  const key = maintenanceComponentKey(a)
  const scoreA = mergeScore(a, statedA, readCadenceFn, key)
  const scoreB = mergeScore(b, statedB, readCadenceFn, key)
  if (scoreA > scoreB || (scoreA === scoreB && a.quote.length >= b.quote.length)) return a
  return b
}

// Groups near-duplicate tasks that target the same appliance component.
export function consolidateExtractedTasks(
  candidates: readonly ExtractedTaskCandidate[],
  opts: MergeExtractedTasksOptions = {},
): ExtractedTaskCandidate[] {
  const best = new Map<string, ExtractedTaskCandidate>()
  for (const candidate of candidates) {
    const key = maintenanceComponentKey(candidate)
    const existing = best.get(key)
    best.set(key, existing ? pickBetterCandidate(existing, candidate, opts) : candidate)
  }
  return [...best.values()]
}

// Combines parallel per-chunk extractions. One entry per normalised task name; prefers a manual
// cadence in the quote and a longer verbatim quote, then consolidates by maintenance component.
export function mergeExtractedTasks(
  candidates: readonly ExtractedTaskCandidate[],
  opts: MergeExtractedTasksOptions = {},
): ExtractedTaskCandidate[] {
  const pageTextByNumber = opts.pageTextByNumber ?? new Map()
  const readCadenceFn = opts.readCadence ?? (() => ({ stated: false }))
  const best = new Map<string, ExtractedTaskCandidate>()
  for (const candidate of candidates) {
    const key = normalisedTaskName(candidate.task)
    const pageText = pageTextByNumber.get(candidate.page)
    const stated = readCadenceFn(candidate.quote, pageText, candidate.task).stated
    const existing = best.get(key)
    if (!existing) {
      best.set(key, candidate)
      continue
    }
    const existingPage = pageTextByNumber.get(existing.page)
    const existingStated = readCadenceFn(existing.quote, existingPage, existing.task).stated
    const score = mergeScore(candidate, stated, readCadenceFn, maintenanceComponentKey(candidate))
    const existingScore = mergeScore(existing, existingStated, readCadenceFn, maintenanceComponentKey(existing))
    if (score > existingScore || (score === existingScore && candidate.quote.length > existing.quote.length)) {
      best.set(key, candidate)
    }
  }
  return consolidateExtractedTasks([...best.values()], opts)
}
