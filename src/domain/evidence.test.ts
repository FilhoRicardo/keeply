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
  const manual = { sourceType: 'manufacturer_manual', modelScope: 'SMS6ZCI49E' }

  it('accepts manufacturer verified only for an exact-model manufacturer source', () => {
    expect(unsupportedEvidence('manufacturer_verified', manual, 'sms6zci-49e')).toBeNull()
    expect(unsupportedEvidence('manufacturer_verified', manual, 'SMS4HVI33E')).toMatch(/exact model/)
    expect(unsupportedEvidence('manufacturer_verified', manual, null)).toMatch(/known model/)
    expect(unsupportedEvidence('manufacturer_verified', { sourceType: 'general_guidance', modelScope: 'SMS6ZCI49E' }, 'SMS6ZCI49E')).toMatch(/manufacturer manual/)
  })

  it('needs a manufacturer or similar-model source for similar-model guidance', () => {
    expect(unsupportedEvidence('similar_model', { sourceType: 'similar_model_manual', modelScope: 'SMS6*' }, null)).toBeNull()
    expect(unsupportedEvidence('similar_model', { sourceType: 'general_guidance', modelScope: null }, null)).toMatch(/similar-model source/)
  })

  it('accepts general guidance from any source', () => {
    expect(unsupportedEvidence('general_guidance', { sourceType: 'general_guidance', modelScope: null }, null)).toBeNull()
  })

  it('keeps every mock recommendation supported', async () => {
    const { mockRecommendations } = await import('./mock-recommendations')
    for (const r of mockRecommendations({ id: 'a' })) expect(unsupportedEvidence(r.evidenceLevel, r.source, null)).toBeNull()
  })
})
