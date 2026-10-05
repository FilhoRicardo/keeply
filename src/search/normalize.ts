// The one text normalisation for manual search. Page text is stored normalised and
// verifyQuote must normalise a quote with this same function before matching.
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/­/g, '')
    .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2')
    .replace(/[‘’′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}
