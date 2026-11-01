// The single text normalisation for manual search. Page text from `src/search/extract-pages`
// is stored already normalised by `normalizeText`. `src/domain/evidence-check` matches a quote
// against page text using the same primitives, plus a `keepLineBreakHyphenation` flag so that
// quotes may match either joined (`dish-\nwasher` -> `dishwasher`) or kept
// (`dish-\nwasher` -> `dish-washer`) forms, as the KEE-38 tests require for true line-break
// hyphenation and genuine hyphenated compounds. Both literal `-` and the soft hyphen (`­`)
// that PDF text extractors commonly leave at line ends are treated the same way.
//
// Deterministic. Idempotent. No IO. No allocations beyond the output string.

const DASHES = /[‐-―−]/g
const QUOTES = /[‘’′]/g
const DOUBLE_QUOTES = /[“”″]/g
const WHITESPACE_RUN = /\s+/g
// PDF and HTML manuals often prefix list lines with bullet glyphs that models omit from quotes.
const LIST_MARKERS = /[\u2022\u2023\u25E6\u2043\u2219]/g

// Word-internal line break: a letter, an optional soft hyphen or hyphen-minus, then a newline,
// then a lowercase letter. Capture group 1 = the first letter; the joining character is
// discarded in joined mode and replaced with `-` in kept mode.
const LINE_BREAK_HYPHEN = /(\p{L})[­-]\s*\n\s*(\p{Ll})/gu

// Standalone soft hyphens NOT followed by a line break. Genuine compounds (no newline) are
// unaffected.
const LONE_SOFT_HYPHEN = /­(?!\s*\n)/g

function unify(text: string): string {
  return text
    .normalize('NFKC')
    .replace(LONE_SOFT_HYPHEN, '')
    .replace(LIST_MARKERS, ' ')
    .replace(QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, '-')
}

/**
 * Canonical normalisation: NFKC, ligature/hyphen/quote unification, line-break hyphenation
 * (joined), whitespace collapse, lowercase. This is what manual page text is stored as.
 */
export function normalizeText(input: string): string {
  return unify(input)
    .replace(LINE_BREAK_HYPHEN, '$1$2')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Like `normalizeText` but keeps `letter[soft hyphen|hyphen-minus]\nletter` as
 * `letter-letter` instead of joining the two halves, so `dish-\nwasher` becomes `dish-washer`
 * (matches `well-known` style compounds).
 */
export function normalizeKeepLineBreaks(input: string): string {
  return unify(input)
    .replace(LINE_BREAK_HYPHEN, '$1-$2')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
    .toLowerCase()
}