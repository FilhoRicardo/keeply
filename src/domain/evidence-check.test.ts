import { describe, expect, it } from 'vitest'
import { EVIDENCE_LEVELS, evidenceLabel, evidenceExplanation } from './evidence'
import { MIN_QUOTE_LENGTH, classifyEvidence, verifyQuote, type ClassifyInput } from './evidence-check'

const QUOTE = 'Clean the filter once a month under running water.'
const DOC = `Care and cleaning\n${QUOTE}\nDo not use abrasive pads.`

const base: ClassifyInput = {
  source: { url: 'https://docs.acme.example/manuals/dw100.pdf', page: 12, documentModels: ['DW-100'], documentFamily: 'DW' },
  model: { name: 'dw-100', family: 'DW' },
  manufacturerDomains: ['acme.example'],
  quote: QUOTE,
  documentText: DOC,
}

describe('verifyQuote', () => {
  it('accepts an exact quote', () => expect(verifyQuote(DOC, QUOTE)).toBe(true))
  it('ignores whitespace, case and line breaks', () => {
    expect(verifyQuote(DOC, 'CLEAN the filter   once a month\nunder running water.')).toBe(true)
  })
  it('handles hyphenation at line breaks, both joined and kept', () => {
    expect(verifyQuote('Remove the dish-\nwasher filter every month.', 'Remove the dishwasher filter every month.')).toBe(true)
    expect(verifyQuote('Use a well-\nknown descaler every month.', 'Use a well-known descaler every month.')).toBe(true)
  })
  it('handles ligatures', () => {
    expect(verifyQuote('Clean the ﬁlter once a month under water.', 'Clean the filter once a month under water.')).toBe(true)
  })
  it('never fuzzy-matches', () => {
    expect(verifyQuote(DOC, 'Clean the filter once a week under running water.')).toBe(false)
    expect(verifyQuote(DOC, 'Clean the filter once a month under running watr.')).toBe(false)
  })
  it('rejects empty and short quotes, accepting exactly the minimum', () => {
    const exact = 'a'.repeat(MIN_QUOTE_LENGTH)
    expect(verifyQuote('', '')).toBe(false)
    expect(verifyQuote('   ', '   ')).toBe(false)
    expect(verifyQuote(exact, exact)).toBe(true)
    const short = 'a'.repeat(MIN_QUOTE_LENGTH - 1)
    expect(verifyQuote(short, short)).toBe(false)
  })
})

describe('classifyEvidence', () => {
  it('is Manufacturer verified only when all four conditions hold', () => {
    expect(classifyEvidence(base)).toEqual({ level: 'manufacturer_verified', reasons: [] })
  })
  it('accepts a subdomain of the manufacturer domain but not a lookalike', () => {
    expect(classifyEvidence({ ...base, source: { ...base.source, url: 'https://acme.example/m.pdf' } }).level).toBe('manufacturer_verified')
    for (const url of ['https://evilacme.example/m.pdf', 'https://acme.example.evil.test/m.pdf', 'https://evil.test/?u=acme.example']) {
      expect(classifyEvidence({ ...base, source: { ...base.source, url } })).toMatchObject({ level: 'similar_model', reasons: ['not_manufacturer_domain'] })
    }
  })
  it('requires https', () => {
    expect(classifyEvidence({ ...base, source: { ...base.source, url: 'http://acme.example/m.pdf' } }).reasons).toContain('not_manufacturer_domain')
  })
  it('does not hard-code brands: empty allowlist never verifies', () => {
    expect(classifyEvidence({ ...base, manufacturerDomains: [] }).level).not.toBe('manufacturer_verified')
  })
  it('downgrades to similar-model when only the family manual is covered', () => {
    const r = classifyEvidence({ ...base, source: { ...base.source, documentModels: ['DW-200'] } })
    expect(r).toEqual({ level: 'similar_model', reasons: ['model_not_covered'] })
  })
  it('downgrades to general guidance when the family differs or is unknown', () => {
    const other = { ...base, source: { ...base.source, documentModels: ['XX-1'], documentFamily: 'XX' } }
    expect(classifyEvidence(other).level).toBe('general_guidance')
    expect(classifyEvidence({ ...other, model: { name: 'dw-100' } }).level).toBe('general_guidance')
  })
  it('downgrades when the quote is not in the document', () => {
    expect(classifyEvidence({ ...base, documentText: 'Nothing relevant here at all, sorry.' })).toMatchObject({ level: 'similar_model', reasons: ['quote_not_found'] })
  })
  it('downgrades when link or page is missing', () => {
    expect(classifyEvidence({ ...base, source: { ...base.source, url: null } }).reasons).toContain('missing_link')
    expect(classifyEvidence({ ...base, source: { ...base.source, page: null } }).reasons).toContain('missing_page')
    expect(classifyEvidence({ ...base, source: { ...base.source, page: 0 } }).reasons).toContain('missing_page')
  })
  it('reports every failing condition', () => {
    const r = classifyEvidence({ ...base, quote: '', source: { ...base.source, page: null, documentModels: [] } })
    expect(r.reasons).toEqual(expect.arrayContaining(['quote_not_found', 'missing_page', 'model_not_covered']))
  })
})

describe('properties', () => {
  // Deterministic enumeration of every combination of the four conditions plus junk.
  const urls = [null, '', 'http://acme.example/a', 'https://evil.test/a', 'https://acme.example/a', 'not a url']
  const pages = [null, 0, -1, 1.5, 3]
  const models = [[], ['DW-200'], ['DW-100'], ['dw-100 ']]
  const quotes = ['', 'short', QUOTE, QUOTE.toUpperCase(), 'Clean the filter once a year under running water.']
  const docs = ['', DOC, 'unrelated text of some length']
  const cases: ClassifyInput[] = []
  for (const url of urls) for (const page of pages) for (const documentModels of models)
    for (const quote of quotes) for (const documentText of docs)
      cases.push({ ...base, source: { ...base.source, url, page, documentModels }, quote, documentText })

  it('never yields Manufacturer verified unless all four conditions hold', () => {
    for (const c of cases) {
      const r = classifyEvidence(c)
      const allFour =
        c.source.url === 'https://acme.example/a' && c.source.page === 3 &&
        c.source.documentModels.some((m) => m.trim().toLowerCase() === 'dw-100') &&
        c.documentText === DOC && c.quote.trim().length >= MIN_QUOTE_LENGTH && verifyQuote(DOC, c.quote)
      expect(r.level === 'manufacturer_verified').toBe(allFour)
      expect(r.reasons.length === 0).toBe(allFour)
    }
  })
  it('level 2 and 3 copy never contains "verified"', () => {
    for (const l of EVIDENCE_LEVELS.filter((l) => l !== 'manufacturer_verified')) {
      expect(`${evidenceLabel(l)} ${evidenceExplanation(l)}`).not.toMatch(/verified/i)
    }
  })
})
