import 'server-only'
import { extractJsonObject } from './identity'

// One page of a manufacturer manual in the same shape that `src/search/extract-pages` returns.
// The provider layer receives these from the manual search and forwards them to the model.
export type ExtractedPage = {
  page: number
  text: string
}

// One candidate the model proposed while reading a manual. Never trusted on its own: P3-1
// (`verifyQuote` and `classifyEvidence`) decides the evidence level, and the page text decides
// whether the quote is even real. `interval` carries the manufacturer's own cadence — Keeply
// shows it but never rewrites it.
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
- Copy the quote VERBATIM from the page text I send you. Never invent or paraphrase a quote. The quote is how a real claim is verified.
- The "page" must be the page number I provided. The quote must appear in that page's text.
- "instructions" is a short summary of what to do, in your own words.
- "interval" is the cadence the manual states (e.g. monthly -> 1, "every 3 months" -> 3). Use unit "day", "week", "month" or "year".
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
  return { task, instructions, quote, page, interval: { count, unit: unit as ExtractedTaskCandidate['interval']['unit'] } }
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
