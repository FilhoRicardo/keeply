import type { EvidenceLevel } from './evidence'

// Shortest quote (after normalising) that can verify anything; shorter text matches by accident.
export const MIN_QUOTE_LENGTH = 20

const normalise = (text: string, joinHyphenation: boolean) =>
  text
    .normalize('NFKC') // folds ligatures such as ﬁ -> fi
    .replace(/­/g, '')
    .replace(joinHyphenation ? /-\s*\n\s*/g : /(-)\s*\n\s*/g, joinHyphenation ? '' : '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

// True only when the quote appears verbatim in the document after normalising whitespace, case,
// line-break hyphenation and ligatures. Exact substring match; never fuzzy.
export function verifyQuote(documentText: string, quote: string): boolean {
  return [true, false].some((join) => {
    const q = normalise(quote, join)
    return q.length >= MIN_QUOTE_LENGTH && normalise(documentText, join).includes(q)
  })
}

export type EvidenceReason =
  | 'missing_link'
  | 'missing_page'
  | 'not_manufacturer_domain'
  | 'model_not_covered'
  | 'quote_not_found'

export type ClassifyInput = {
  source: { url: string | null; page: number | null; documentModels: string[]; documentFamily?: string }
  model: { name: string; family?: string }
  manufacturerDomains: string[]
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
// covers this exact model, the quote is found in the document text, and link and page are present.
// Otherwise Similar-model (same family manual) or General guidance, with every failing reason.
export function classifyEvidence({ source, model, manufacturerDomains, quote, documentText }: ClassifyInput): EvidenceClassification {
  const reasons: EvidenceReason[] = []
  if (!source.url?.trim()) reasons.push('missing_link')
  else if (!onManufacturerDomain(source.url, manufacturerDomains)) reasons.push('not_manufacturer_domain')
  if (!Number.isInteger(source.page) || (source.page as number) < 1) reasons.push('missing_page')
  if (!source.documentModels.some((m) => sameModel(m, model.name))) reasons.push('model_not_covered')
  if (!verifyQuote(documentText, quote)) reasons.push('quote_not_found')

  if (reasons.length === 0) return { level: 'manufacturer_verified', reasons }
  const sameFamily =
    !!model.family && !!source.documentFamily && sameModel(model.family, source.documentFamily)
  return { level: sameFamily ? 'similar_model' : 'general_guidance', reasons }
}
