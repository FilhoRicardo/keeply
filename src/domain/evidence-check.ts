import type { EvidenceLevel } from './evidence'
import { normalizeKeepLineBreaks, normalizeText } from './normalize'
import { quoteIsAboutTask } from './quote-about-task'

// Shortest quote (after normalising) that can verify anything; shorter text matches by accident.
export const MIN_QUOTE_LENGTH = 20

// Mirrors maintenance_tasks.source_quote check (length(source_quote) <= 1000).
export const MAX_SOURCE_QUOTE_LENGTH = 1000

export function sourceQuoteSatisfiesDbCheck(quote: string | null | undefined): boolean {
  return quote == null || quote.length <= MAX_SOURCE_QUOTE_LENGTH
}

// True only when the quote appears verbatim in the document after normalising whitespace, case,
// line-break hyphenation and ligatures. Tries both joined (`dish-\nwasher` -> `dishwasher`) and
// kept (`dish-\nwasher` -> `dish-washer`) hyphenation so genuine hyphenated compounds match too.
// Exact substring match; never fuzzy.
export function verifyQuote(documentText: string, quote: string): boolean {
  const doc = normalizeText(documentText)
  const docKept = normalizeKeepLineBreaks(documentText)
  const q = normalizeText(quote)
  const qKept = normalizeKeepLineBreaks(quote)
  if (q.length >= MIN_QUOTE_LENGTH && doc.includes(q)) return true
  return qKept.length >= MIN_QUOTE_LENGTH && docKept.includes(qKept)
}

export type EvidenceReason =
  | 'missing_link'
  | 'missing_page'
  | 'not_manufacturer_domain'
  | 'model_not_covered'
  | 'quote_not_found'
  | 'quote_not_about_task'

export type ClassifyInput = {
  source: { url: string | null; page: number | null; documentModels: string[]; documentFamily?: string }
  model: { name: string; family?: string }
  manufacturerDomains: string[]
  task: string
  quote: string
  documentText: string
}

export type EvidenceClassification = { level: EvidenceLevel; reasons: EvidenceReason[] }

const sameModel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function onManufacturerDomain(url: string, domains: string[]): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return domains.some((d) => {
    const domain = d.trim().toLowerCase()
    return domain !== '' && (host === domain || host.endsWith(`.${domain}`))
  })
}

// Manufacturer verified only when the link is on the manufacturer's own https domain, the document
// covers this exact model, the quote is found in the document text and is about the task, and
// link and page are present. Similar-model needs the same quote, page and link, plus a matching
// product family. A missing, unfound or off-task quote, or a missing page or link, stays General
// guidance even when the family matches. A different family stays General guidance too. Every
// failing reason is still reported.
export function classifyEvidence({ source, model, manufacturerDomains, task, quote, documentText }: ClassifyInput): EvidenceClassification {
  const reasons: EvidenceReason[] = []
  if (!source.url?.trim()) reasons.push('missing_link')
  else if (!onManufacturerDomain(source.url, manufacturerDomains)) reasons.push('not_manufacturer_domain')
  if (!Number.isInteger(source.page) || (source.page as number) < 1) reasons.push('missing_page')
  if (!source.documentModels.some((m) => sameModel(m, model.name))) reasons.push('model_not_covered')
  if (!verifyQuote(documentText, quote)) reasons.push('quote_not_found')
  if (!quoteIsAboutTask(task, quote)) reasons.push('quote_not_about_task')

  if (reasons.length === 0) return { level: 'manufacturer_verified', reasons }
  const sameFamily =
    !!model.family && !!source.documentFamily && sameModel(model.family, source.documentFamily)
  const blocksSimilar = reasons.some((reason) =>
    reason === 'missing_link' || reason === 'missing_page' || reason === 'quote_not_found' || reason === 'quote_not_about_task')
  return { level: sameFamily && !blocksSimilar ? 'similar_model' : 'general_guidance', reasons }
}