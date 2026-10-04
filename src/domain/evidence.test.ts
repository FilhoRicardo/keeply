import { describe, expect, it } from 'vitest'
import {
  EVIDENCE_LEVELS,
  evidenceExplanation,
  evidenceLabel,
  evidenceRank,
  isManufacturerVerified,
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
