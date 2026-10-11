// Product family of a model number, and whether a manual's cover names that family.
// The server derives both. A client-sent family is never an input.

// PDF cover, shared with coversModel: a model number only on a later page does not count.
export const COVER_PAGE_COUNT = 2

// HTML from extract-pages is a single page. Its cover is the page title plus this many
// characters of the extracted text, so a later "related manuals" list does not count.
export const HTML_COVER_TEXT_LIMIT = 2000

type CoverPage = { page: number; text: string; title?: string }

// Text that may name a covered model. An HTML page carries `title` (possibly ""). A PDF page
// does not, and its full text is the cover when the caller has already kept pages 1–2.
export function coverWindowText(page: CoverPage): string {
  if (page.title === undefined) return page.text
  const body = page.text.slice(0, HTML_COVER_TEXT_LIMIT)
  const title = page.title.trim()
  return title ? `${title}\n${body}` : body
}

// Stored in source_location so the covered model survives without a schema change.
const COVERED_MODEL_MARK = ' | covers '

function normalizeModelNumber(model: string): string {
  return model.trim().toUpperCase().replace(/ /g, '')
}

// Family of a model number. Trim, uppercase, drop spaces. With a "-" or "/", the family is
// the part before the first one. Otherwise trailing letters after the last digit are removed.
// No family when that result is shorter than 4 characters or has no digit.
export function modelFamily(model: string): string | null {
  const normalized = normalizeModelNumber(model)
  if (!normalized) return null
  const splitAt = normalized.search(/[-/]/)
  const family = splitAt === -1 ? stripTrailingLetters(normalized) : normalized.slice(0, splitAt)
  if (family.length < 4 || !/\d/.test(family)) return null
  return family
}

function stripTrailingLetters(normalized: string): string {
  let lastDigit = -1
  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i)
    if (code >= 48 && code <= 57) lastDigit = i
  }
  if (lastDigit === -1) return normalized
  return normalized.slice(0, lastDigit + 1)
}

function isModelToken(token: string): boolean {
  return token.length >= 5 && /[A-Z]/.test(token) && /\d/.test(token)
}

// Model-number tokens on the cover, in page order. A token is a run of letters, digits,
// "-" or "/" with at least one letter, one digit, and 5 characters. HTML uses the title plus
// the first HTML_COVER_TEXT_LIMIT characters; PDF uses the full text of pages 1–2.
export function coverModelTokens(pages: readonly CoverPage[]): string[] {
  const cover = pages.filter((p) => p.page <= COVER_PAGE_COUNT).sort((a, b) => a.page - b.page)
  const tokens: string[] = []
  for (const page of cover) {
    for (const match of coverWindowText(page).matchAll(/[A-Za-z0-9/-]+/g)) {
      const token = match[0].toUpperCase()
      if (isModelToken(token)) tokens.push(token)
    }
  }
  return tokens
}

// The cover model to show when the document's family matches the owner's. Prefers the owner's
// own model number when the cover names it (a third-party copy). Null when nothing on the cover
// shares the family, including a token that appears only after the cover pages.
export function matchingCoverModel(pages: readonly CoverPage[], ownerModel: string): string | null {
  const family = modelFamily(ownerModel)
  if (!family) return null
  const owner = normalizeModelNumber(ownerModel)
  const matches = coverModelTokens(pages).filter((token) => modelFamily(token) === family)
  if (matches.length === 0) return null
  return matches.find((token) => token === owner) ?? matches[0]
}

// Honest Similar-model sentence. An exact model on a non-manufacturer host is not a family-only match.
export function similarModelNotice(ownerModel: string | null | undefined, coveredModel: string): string {
  const owner = normalizeModelNumber(ownerModel ?? '')
  const covered = normalizeModelNumber(coveredModel)
  if (owner && covered && owner === covered) {
    return 'Manual for your model, found on a third-party site (not the manufacturer’s). Not verified.'
  }
  return `Manual for a similar model (${covered}). Not verified for your exact model.`
}

export function encodeSourceLocation(location: string | null, coveredModel: string | null | undefined): string | null {
  const model = coveredModel?.trim()
  if (!model) return location
  const page = location?.trim()
  if (!page) return location
  return `${page}${COVERED_MODEL_MARK}${model}`
}

export function decodeSourceLocation(stored: string | null): { location: string | null; coveredModel: string | null } {
  if (!stored) return { location: null, coveredModel: null }
  const idx = stored.indexOf(COVERED_MODEL_MARK)
  if (idx === -1) return { location: stored, coveredModel: null }
  const location = stored.slice(0, idx).trim() || null
  const coveredModel = stored.slice(idx + COVERED_MODEL_MARK.length).trim() || null
  return { location, coveredModel }
}

// Location for display, plus the covered model from the field or from a stored location.
export function presentCoveredSource(source: { location: string | null; coveredModel?: string | null }): {
  location: string | null
  coveredModel: string | null
} {
  const decoded = decodeSourceLocation(source.location)
  return { location: decoded.location, coveredModel: source.coveredModel?.trim() || decoded.coveredModel }
}
