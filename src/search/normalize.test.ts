import { describe, expect, it } from 'vitest'
import { normalizeText } from './normalize'

describe('normalizeText', () => {
  it('collapses whitespace and lowercases', () => {
    expect(normalizeText('  Clean the\n\tFILTER  ')).toBe('clean the filter')
  })
  it('joins words hyphenated across a line break', () => {
    expect(normalizeText('main-\ntenance')).toBe('maintenance')
  })
  it('unifies quotes, dashes, soft hyphens and ligatures', () => {
    expect(normalizeText('It’s a “test” – ok­ ﬁlter')).toBe('it\'s a "test" - ok filter')
  })
  it('is idempotent', () => {
    const once = normalizeText('Rinse-\naid  “level”')
    expect(normalizeText(once)).toBe(once)
  })
})
