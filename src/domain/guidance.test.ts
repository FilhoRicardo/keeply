import { describe, expect, it } from 'vitest'
import { unsupportedEvidence } from './evidence'
import { proposeRecommendations, type CatalogEntry } from './guidance'

// Fixture data only: not real manufacturer guidance.
const entry = (overrides: Partial<CatalogEntry> = {}): CatalogEntry => ({
  manufacturer: 'Bosch',
  modelScope: 'SMS6ZCI49E',
  sourceType: 'manufacturer_manual',
  title: 'Fixture manual',
  reference: 'https://example.com/manual.pdf',
  sourceLocation: 'p. 40',
  taskName: 'Clean the filters',
  description: 'Fixture description.',
  interval: { count: 1, unit: 'month' },
  ...overrides,
})

const dishwasher = (model: string | null, manufacturer = 'Bosch') => ({ id: 'a', manufacturer, model })

describe('proposeRecommendations', () => {
  it('labels exact-model manufacturer entries as Manufacturer verified', () => {
    const [rec] = proposeRecommendations(dishwasher('sms6zci-49e'), [entry(), entry({ modelScope: 'SMS6*', taskName: 'Family task' })])
    expect(rec).toMatchObject({ taskName: 'Clean the filters', evidenceLevel: 'manufacturer_verified', sourceLocation: 'p. 40' })
  })

  it('uses family entries as Similar-model guidance when there is no exact match', () => {
    const recs = proposeRecommendations(dishwasher('SMS6ECI03E'), [entry(), entry({ modelScope: 'SMS6*', taskName: 'Family task' })])
    expect(recs.map((r) => [r.taskName, r.evidenceLevel])).toEqual([['Family task', 'similar_model']])
  })

  it('falls back to General guidance for an unknown model, a missing model or another brand', () => {
    for (const appliance of [dishwasher('XYZ'), dishwasher(null), dishwasher('SMS6ZCI49E', 'Miele')]) {
      const recs = proposeRecommendations(appliance, [entry(), entry({ modelScope: 'SMS6*' })])
      expect(recs.every((r) => r.evidenceLevel === 'general_guidance')).toBe(true)
    }
  })

  it('never produces an unsupported evidence claim', () => {
    const catalog = [entry(), entry({ modelScope: 'SMS6*' }), entry({ sourceType: 'manufacturer_website', modelScope: 'SMS4*' })]
    for (const model of ['SMS6ZCI49E', 'SMS6ECI03E', 'SMS4HVI33E', 'OTHER', null]) {
      for (const r of proposeRecommendations(dishwasher(model), catalog)) {
        expect(unsupportedEvidence(r.evidenceLevel, r.source, model)).toBeNull()
      }
    }
  })

  it('ignores an empty family prefix', () => {
    const recs = proposeRecommendations(dishwasher('SMS6ZCI49E'), [entry({ modelScope: '*' })])
    expect(recs.every((r) => r.evidenceLevel === 'general_guidance')).toBe(true)
  })
})
