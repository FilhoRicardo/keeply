import { describe, expect, it } from 'vitest'
import {
  coverModelTokens,
  decodeSourceLocation,
  encodeSourceLocation,
  matchingCoverModel,
  modelFamily,
  presentCoveredSource,
  similarModelNotice,
} from './model-family'

describe('modelFamily', () => {
  it.each([
    ['DI6012-1', 'DI6012'],
    ['KEQB7300L', 'KEQB7300'],
    ['KEQC7200L', 'KEQC7200'],
    ['SMS6ZCI49E', 'SMS6ZCI49'],
    ['  di 6012-1  ', 'DI6012'],
    ['ABC12/99', 'ABC12'],
  ])('family of %s is %s', (model, family) => {
    expect(modelFamily(model)).toBe(family)
  })

  it('has no family when the result is shorter than 4 characters or has no digit', () => {
    expect(modelFamily('WV9-6S')).toBeNull()
    expect(modelFamily('WV9')).toBeNull()
    expect(modelFamily('ABCD-1')).toBeNull()
    expect(modelFamily('ABCD')).toBeNull()
    expect(modelFamily('')).toBeNull()
    expect(modelFamily('   ')).toBeNull()
  })
})

describe('cover-page family detection', () => {
  it('reads model-number tokens on the first two pages and ignores a token on page 3', () => {
    const pages = [
      { page: 1, text: 'User manual DI6012-2' },
      { page: 2, text: 'Also covers KEQB7300L' },
      { page: 3, text: 'See also KEQC7200L and SMS6ZCI49E' },
    ]
    expect(coverModelTokens(pages)).toEqual(['DI6012-2', 'KEQB7300L'])
    expect(matchingCoverModel(pages, 'DI6012-1')).toBe('DI6012-2')
    expect(matchingCoverModel(pages, 'KEQC7200L')).toBeNull()
    expect(matchingCoverModel(pages, 'SMS6ZCI49E')).toBeNull()
  })

  it('rejects tokens that are too short or lack a letter or a digit', () => {
    expect(coverModelTokens([{ page: 1, text: 'AB12 123456 ABCDE WV9-6S' }])).toEqual(['WV9-6S'])
    expect(matchingCoverModel([{ page: 1, text: 'WV9-6S' }], 'WV9-6S')).toBeNull()
  })

  it('prefers the owner’s exact model when the cover names it and another family member', () => {
    const pages = [
      { page: 2, text: 'DI6012-2' },
      { page: 1, text: 'Models: DI6012-1' },
    ]
    expect(matchingCoverModel(pages, 'di 6012-1')).toBe('DI6012-1')
  })

  it('does not treat a different family as a match', () => {
    expect(matchingCoverModel([{ page: 1, text: 'Manual KEQC7200L' }], 'KEQB7300L')).toBeNull()
    expect(matchingCoverModel([{ page: 1, text: 'Manual KEQB7300W' }], 'KEQB7300L')).toBe('KEQB7300W')
  })
})

// HTML from extract-pages is one page. Its cover is the title plus the first 2,000 characters
// of that page, so a "related manuals" list further down does not count. PDF pages have no title
// field and keep their full text.
const HTML_BODY_LIMIT = 2000
const PAST_THE_COVER = 'lorem ipsum '.repeat(200)

describe('HTML cover window', () => {
  it('ignores a model that appears only after the first 2,000 characters', () => {
    const text = `${PAST_THE_COVER}related manuals DI6012-1`
    expect(text.indexOf('DI6012-1')).toBeGreaterThanOrEqual(HTML_BODY_LIMIT)
    const page = { page: 1, text, title: 'Dishwasher support' }
    expect(coverModelTokens([page])).toEqual([])
    expect(matchingCoverModel([page], 'DI6012-1')).toBeNull()
    expect(matchingCoverModel([{ page: 1, text, title: '' }], 'DI6012-1')).toBeNull()
  })

  it('matches a model inside the first 2,000 characters and ignores a later related manual', () => {
    const text = `User manual DI6012-2. ${PAST_THE_COVER}related manuals DI6012-9`
    expect(text.indexOf('DI6012-2')).toBeLessThan(HTML_BODY_LIMIT)
    expect(text.indexOf('DI6012-9')).toBeGreaterThanOrEqual(HTML_BODY_LIMIT)
    const page = { page: 1, text, title: 'Care' }
    expect(coverModelTokens([page])).toEqual(['DI6012-2'])
    expect(matchingCoverModel([page], 'DI6012-1')).toBe('DI6012-2')
  })

  it('counts a model named in the page title even when the body mention is past the window', () => {
    const text = `${PAST_THE_COVER}related manuals DI6012-9`
    expect(text.indexOf('DI6012-9')).toBeGreaterThanOrEqual(HTML_BODY_LIMIT)
    const page = { page: 1, text, title: 'Manual for DI6012-2' }
    expect(coverModelTokens([page])).toEqual(['DI6012-2'])
    expect(matchingCoverModel([page], 'DI6012-1')).toBe('DI6012-2')
  })

  it('keeps the whole first PDF page, including a model past character 2,000', () => {
    const text = `${PAST_THE_COVER}User manual DI6012-1`
    expect(text.indexOf('DI6012-1')).toBeGreaterThanOrEqual(HTML_BODY_LIMIT)
    const page = { page: 1, text }
    expect(coverModelTokens([page])).toEqual(['DI6012-1'])
    expect(matchingCoverModel([page], 'DI6012-1')).toBe('DI6012-1')
  })
})

describe('similarModelNotice', () => {
  it('names the covered model for a family-only match', () => {
    expect(similarModelNotice('DI6012-1', 'DI6012-2')).toBe(
      'Manual for a similar model (DI6012-2). Not verified for your exact model.',
    )
  })

  it('says a third-party copy of the exact model is not verified', () => {
    expect(similarModelNotice('di 6012-1', 'DI6012-1')).toBe(
      'Manual for your model, found on a third-party site (not the manufacturer’s). Not verified.',
    )
  })
})

describe('source location codec', () => {
  it('round-trips the covered model and leaves a plain location alone', () => {
    expect(encodeSourceLocation('page 18', 'DI6012-2')).toBe('page 18 | covers DI6012-2')
    expect(decodeSourceLocation('page 18 | covers DI6012-2')).toEqual({ location: 'page 18', coveredModel: 'DI6012-2' })
    expect(decodeSourceLocation('page 32')).toEqual({ location: 'page 32', coveredModel: null })
    expect(encodeSourceLocation('page 18', null)).toBe('page 18')
    expect(encodeSourceLocation(null, 'DI6012-2')).toBeNull()
    expect(presentCoveredSource({ location: 'page 18 | covers DI6012-2' })).toEqual({
      location: 'page 18',
      coveredModel: 'DI6012-2',
    })
    expect(presentCoveredSource({ location: 'page 18', coveredModel: 'DI6012-2' })).toEqual({
      location: 'page 18',
      coveredModel: 'DI6012-2',
    })
  })
})
