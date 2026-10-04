import { describe, expect, it } from 'vitest'
import { mockRecommendations } from './mock-recommendations'

describe('mockRecommendations', () => {
  const recs = mockRecommendations({ id: 'app-9' })

  it('proposes three dishwasher tasks for the appliance', () => {
    expect(recs).toHaveLength(3)
    expect(recs.every((r) => r.applianceId === 'app-9')).toBe(true)
    expect(new Set(recs.map((r) => r.id)).size).toBe(3)
  })

  it('never claims manufacturer verification for an unlooked-up appliance', () => {
    expect(recs.every((r) => r.evidenceLevel === 'general_guidance')).toBe(true)
    expect(recs.every((r) => r.source.sourceType === 'general_guidance')).toBe(true)
  })

  it('returns fresh intervals each call', () => {
    const [a] = mockRecommendations({ id: 'x' })
    const [b] = mockRecommendations({ id: 'x' })
    expect(a.recommendedInterval).not.toBe(b.recommendedInterval)
  })
})
