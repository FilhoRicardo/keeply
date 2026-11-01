import { describe, expect, it } from 'vitest'
import { EVIDENCE_LEVELS, evidenceLabel, evidenceExplanation } from './evidence'
import { MIN_QUOTE_LENGTH, classifyEvidence, verifyQuote, type ClassifyInput } from './evidence-check'
import { quoteIsAboutTask } from './quote-about-task'

const QUOTE = 'Clean the filter once a month under running water.'
const DOC = `Care and cleaning\n${QUOTE}\nDo not use abrasive pads.`

const base: ClassifyInput = {
  source: { url: 'https://docs.acme.example/manuals/dw100.pdf', page: 12, documentModels: ['DW-100'], documentFamily: 'DW' },
  model: { name: 'dw-100', family: 'DW' },
  manufacturerDomains: ['acme.example'],
  task: 'Clean the filter',
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
  it('downgrades when the quote is not in the document, and does not keep Similar-model', () => {
    expect(classifyEvidence({ ...base, documentText: 'Nothing relevant here at all, sorry.' })).toMatchObject({
      level: 'general_guidance',
      reasons: ['quote_not_found'],
    })
  })
  it('downgrades when link or page is missing, and does not keep Similar-model on family alone', () => {
    expect(classifyEvidence({ ...base, source: { ...base.source, url: null } })).toMatchObject({
      level: 'general_guidance',
      reasons: expect.arrayContaining(['missing_link']),
    })
    expect(classifyEvidence({ ...base, source: { ...base.source, page: null } })).toMatchObject({
      level: 'general_guidance',
      reasons: expect.arrayContaining(['missing_page']),
    })
    expect(classifyEvidence({ ...base, source: { ...base.source, page: 0 } })).toMatchObject({
      level: 'general_guidance',
      reasons: expect.arrayContaining(['missing_page']),
    })
  })
  it('downgrades to general guidance when the quote is about something else, and does not keep Similar-model', () => {
    const offTask = { ...base, task: 'Clean the door seal' }
    expect(classifyEvidence(offTask)).toEqual({ level: 'general_guidance', reasons: ['quote_not_about_task'] })
    const familyOnly = { ...offTask, source: { ...offTask.source, documentModels: ['DW-200'] } }
    expect(classifyEvidence(familyOnly)).toMatchObject({ level: 'general_guidance' })
  })
  it('reports every failing condition', () => {
    const r = classifyEvidence({ ...base, quote: '', source: { ...base.source, page: null, documentModels: [] } })
    expect(r.reasons).toEqual(expect.arrayContaining(['quote_not_found', 'missing_page', 'model_not_covered']))
  })
})

// Real run, 2026-10-31: Electrolux KEQB7300L, official manual, OpenRouter extraction.
describe('Electrolux KEQB7300L extraction', () => {
  const electrolux = (task: string, quote: string, page: number): ClassifyInput => ({
    source: { url: 'https://api.electrolux-medialibrary.com/asset/manual.pdf', page, documentModels: ['KEQB7300L'] },
    model: { name: 'KEQB7300L' },
    manufacturerDomains: ['electrolux-medialibrary.com'],
    task,
    quote,
    documentText: `Care and cleaning. ${quote} More text.`,
  })

  it('does not verify "Clean the filters" with the weekly door-gasket quote', () => {
    const r = classifyEvidence(electrolux('Clean the filters', 'wipe clean the door, including the rubber gasket, once a week.', 22))
    expect(r).toEqual({ level: 'general_guidance', reasons: ['quote_not_about_task'] })
  })
  it.each([
    ['Clean the lower spray arm', 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.', 23],
    ['Clean the upper spray arm', 'we recommend to clean the upper spray arm regularly to prevent soil from clogging the holes.', 24],
    ['Clean the ceiling spray arm', 'we recommend to clean the ceiling spray arm regularly to prevent soil from clogging the holes.', 24],
    ['Check for foreign objects in the filters and sump', 'check the filters and the sump after each use of the dishwasher.', 22],
    // Second run, same manual: other task names and quotes from the same pages.
    ['Check for foreign objects', 'check the filters and the sump after each use of the dishwasher. foreign objects (e.g. pieces of glass, plastic, bones or toothpicks, etc) decrease the cleaning performance and can cause damage to the drain pump.', 22],
    ['Clean the filters', 'dirty filters and clogged spray arms negatively affect the washing results. check these elements regularly and, if necessary, clean them.', 21],
    [
      'Run Machine Care with dishwasher cleaner',
      'to maintain the performance of your appliance, use a cleaning product designed specifically for dishwashers at least once every two months. for optimal cleaning results, start the programme machine care.',
      22,
    ],
  ])('keeps "%s" Manufacturer verified', (task, quote, page) => {
    expect(classifyEvidence(electrolux(task, quote, page))).toEqual({ level: 'manufacturer_verified', reasons: [] })
  })
})

describe('quoteIsAboutTask', () => {
  it('needs an object from the task name in the quote', () => {
    expect(quoteIsAboutTask('Clean the filter', 'Rinse the filter under running water.')).toBe(true)
    expect(quoteIsAboutTask('Clean the filter', 'Wipe the door once a week.')).toBe(false)
  })
  it('matches singular and plural either way', () => {
    expect(quoteIsAboutTask('Clean the filters', 'Clean the filter every month.')).toBe(true)
    expect(quoteIsAboutTask('Clean the spray arm', 'Check the spray arms every 3 months.')).toBe(true)
    expect(quoteIsAboutTask('Wipe the shelves', 'Wipe each shelf monthly.')).toBe(true)
  })
  it('treats the words manuals use for the same part as one object', () => {
    expect(quoteIsAboutTask('Clean the door seal', 'Wipe the rubber gasket once a week.')).toBe(true)
    expect(quoteIsAboutTask('Descale the machine', 'Run a descaling programme every 3 months.')).toBe(true)
  })
  it('matches whole words and whole multi-word objects only', () => {
    expect(quoteIsAboutTask('Clean the spray arm', 'Reset the alarm and spray the door.')).toBe(false)
    expect(quoteIsAboutTask('Top up the rinse aid', 'Rinse the filter after each use.')).toBe(false)
    expect(quoteIsAboutTask('Check the salt', 'Check the basalt worktop.')).toBe(false)
  })
  it('never matches a task whose name names no known object', () => {
    expect(quoteIsAboutTask('Look after the appliance', 'Look after the appliance every month.')).toBe(false)
  })
  it('ignores case and line-break hyphenation', () => {
    expect(quoteIsAboutTask('CLEAN THE FILTER', 'Remove the fil-\nter every month.')).toBe(true)
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

  it('never yields Manufacturer verified unless all conditions hold', () => {
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
