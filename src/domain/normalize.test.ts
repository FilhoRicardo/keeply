import { describe, expect, it } from 'vitest'
import { normalizeKeepLineBreaks, normalizeText } from './normalize'

describe('normalizeText', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeText('  Clean the\n\tFILTER  ')).toBe('clean the filter')
  })
  it('joins words hyphenated across a line break (literal hyphen)', () => {
    expect(normalizeText('main-\ntenance')).toBe('maintenance')
    expect(normalizeText('dish-\nwasher filter')).toBe('dishwasher filter')
  })
  it('joins words across a line break when only a soft hyphen was left at line end (real PDF case)', () => {
    expect(normalizeText('dish­\nwasher filter')).toBe('dishwasher filter')
    expect(normalizeText('main­\ntenance')).toBe('maintenance')
  })
  it('unifies quotes, dashes, soft hyphens and ligatures', () => {
    expect(normalizeText('It’s a "test" – ok­ ﬁlter')).toBe("it's a \"test\" - ok filter")
  })
  it('is idempotent', () => {
    const once = normalizeText('Rinse­\naid  "level"')
    expect(normalizeText(once)).toBe(once)
  })
  it('strips a leading soft hyphen left over from a PDF line break', () => {
    expect(normalizeText('dish­washer filter')).toBe('dishwasher filter')
  })
})

describe('normalizeKeepLineBreaks', () => {
  it('keeps the hyphen for literal hyphen line-break hyphenation', () => {
    expect(normalizeKeepLineBreaks('main-\ntenance')).toBe('main-tenance')
    expect(normalizeKeepLineBreaks('well-\nknown descaler')).toBe('well-known descaler')
  })
  it('treats a trailing soft hyphen at a line break as a literal dash', () => {
    expect(normalizeKeepLineBreaks('main­\ntenance')).toBe('main-tenance')
    expect(normalizeKeepLineBreaks('well­\nknown descaler')).toBe('well-known descaler')
  })
  it('otherwise behaves like normalizeText', () => {
    expect(normalizeKeepLineBreaks('  Clean the\n\tFILTER  ')).toBe('clean the filter')
    expect(normalizeKeepLineBreaks('It’s a "test" – ok­')).toBe("it's a \"test\" - ok")
  })
})