import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_LEVELS,
  evidenceExplanation,
  evidenceLabel,
  evidenceRank,
  isManufacturerVerified,
  unsupportedEvidence,
} from './evidence'

describe('Evidence levels', () => {
  it('ranks the three levels 1, 2, 3', () => {
    expect(EVIDENCE_LEVELS.map(evidenceRank)).toEqual([1, 2, 3])
  })

  it('only level 1 counts as manufacturer verified', () => {
    expect(EVIDENCE_LEVELS.filter(isManufacturerVerified)).toEqual(['manufacturer_verified'])
  })

  it.each(['similar_model', 'general_guidance'] as const)(
    'never labels %s with the word "verified"',
    (level) => {
      expect(evidenceLabel(level)).not.toMatch(/verified/i)
    },
  )

  it.each(['similar_model', 'general_guidance'] as const)(
    'says plainly what is unknown for %s',
    (level) => {
      expect(evidenceExplanation(level)).toMatch(/could not/i)
    },
  )

  it('gives every level a distinct label', () => {
    expect(new Set(EVIDENCE_LEVELS.map(evidenceLabel)).size).toBe(3)
  })
})

describe('unsupportedEvidence', () => {
  const manual = { type: 'manufacturer_manual', url: 'https://www.bosch-home.com/manual.pdf', quote: 'Clean the filters regularly.' }

  it('accepts manufacturer verified only with a linked, quoted manufacturer document', () => {
    expect(unsupportedEvidence('manufacturer_verified', manual)).toBeNull()
    expect(unsupportedEvidence('manufacturer_verified', { ...manual, quote: '  ' })).toMatch(/quote/)
    expect(unsupportedEvidence('manufacturer_verified', { ...manual, quote: null })).toMatch(/quote/)
    expect(unsupportedEvidence('manufacturer_verified', { ...manual, url: 'http://example.com/manual.pdf' })).toMatch(/https link/)
    expect(unsupportedEvidence('manufacturer_verified', { ...manual, url: null })).toMatch(/https link/)
    expect(unsupportedEvidence('manufacturer_verified', { ...manual, type: 'similar_model_manual' })).toMatch(/manufacturer manual/)
    expect(unsupportedEvidence('manufacturer_verified', { ...manual, type: 'general_guidance' })).toMatch(/manufacturer manual/)
  })

  it('needs a manufacturer or similar-model source for similar-model guidance', () => {
    expect(unsupportedEvidence('similar_model', { type: 'similar_model_manual', url: null, quote: null })).toBeNull()
    expect(unsupportedEvidence('similar_model', { type: 'general_guidance', url: null, quote: null })).toMatch(/similar-model source/)
  })

  it('accepts general guidance from any source', () => {
    expect(unsupportedEvidence('general_guidance', { type: 'general_guidance', url: null, quote: null })).toBeNull()
  })

  it('keeps every general dishwasher task supported', async () => {
    const { GENERAL_DISHWASHER_TASKS } = await import('./general-guidance')
    for (const t of GENERAL_DISHWASHER_TASKS) expect(unsupportedEvidence(t.evidenceLevel, t.source)).toBeNull()
  })
})
