import { describe, expect, it } from 'vitest'
import { extractJsonObject, IDENTITY_INSTRUCTIONS, normaliseIdentity } from './identity'

describe('extractJsonObject', () => {
  it('finds the object inside prose, fences and nested braces', () => {
    expect(extractJsonObject('Sure! {"a": {"b": "}"}, "c": 1} done')).toEqual({ a: { b: '}' }, c: 1 })
    expect(extractJsonObject('no json')).toBeNull()
    expect(extractJsonObject('{broken')).toBeNull()
    expect(extractJsonObject('The label reads {Bosch}: {"model": "X"}')).toEqual({ model: 'X' })
  })
})

describe('IDENTITY_INSTRUCTIONS', () => {
  it('tells the model to use unknown unless the category is printed, and that oven is not a default', () => {
    expect(IDENTITY_INSTRUCTIONS).toContain('typeEvidence')
    expect(IDENTITY_INSTRUCTIONS).toMatch(/does not print the kind of appliance/)
    expect(IDENTITY_INSTRUCTIONS).toContain('"unknown"')
    expect(IDENTITY_INSTRUCTIONS).toContain('"oven" is not a default')
    expect(IDENTITY_INSTRUCTIONS).toMatch(/Do not guess a category/)
  })
})

describe('normaliseIdentity', () => {
  it('maps unknown types and junk fields safely', () => {
    expect(normaliseIdentity({
      applianceType: 'washing machine',
      typeEvidence: 'Washing machine',
      manufacturer: ' Bosch ',
      model: 42,
      confidence: 'high',
    })).toEqual({
      applianceType: 'washing machine',
      manufacturer: 'Bosch',
      model: null,
      serialNumber: null,
      confidence: 0,
    })
    expect(normaliseIdentity('nope')).toBeNull()
  })

  it('keeps a category the label actually prints', () => {
    // KEE-60: a fridge label is a valid appliance. RF-350: only when the printed words name it.
    expect(normaliseIdentity({ applianceType: 'Fridge', typeEvidence: 'Refrigerator', manufacturer: 'LG', model: 'LRFXS2503S', confidence: 0.7 })?.applianceType).toBe('fridge')
    expect(normaliseIdentity({ applianceType: 'Washing Machine', typeEvidence: 'Washing machine', manufacturer: 'Miele', model: 'WSD663', confidence: 0.6 })?.applianceType).toBe('washing machine')
    expect(normaliseIdentity({ applianceType: 'Oven', typeEvidence: 'Built-in oven', manufacturer: 'Bosch', model: 'HBL8443', confidence: 0.55 })?.applianceType).toBe('oven')
    expect(normaliseIdentity({ applianceType: 'oven', typeEvidence: 'Dishwasher', manufacturer: 'Electrolux', model: 'KEQB7300L', confidence: 0.9 })?.applianceType).toBe('dishwasher')
    expect(normaliseIdentity({ applianceType: 'air fryer', typeEvidence: 'Air fryer', manufacturer: 'Ninja', model: 'AF100', confidence: 0.4 })?.applianceType).toBe('air fryer')
  })

  it('drops a guessed category, including oven, when the label does not print one', () => {
    expect(normaliseIdentity({ applianceType: 'oven', manufacturer: 'Electrolux', model: 'KEQB7300L', serialNumber: 'ABC', confidence: 0.91 })).toEqual({
      applianceType: 'unknown',
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
      serialNumber: 'ABC',
      confidence: 0.91,
    })
    expect(normaliseIdentity({ applianceType: 'oven', typeEvidence: null, manufacturer: 'Bosch', model: 'HBL8443', confidence: 0.8 })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ applianceType: 'oven', typeEvidence: 'a proven design', manufacturer: 'Bosch', model: 'HBL8443', confidence: 0.8 })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ applianceType: 'fridge', manufacturer: 'LG', model: 'LRFXS2503S', confidence: 0.7 })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ applianceType: 'oven', typeEvidence: 'dishwasher oven', manufacturer: 'Bosch', model: 'HBL8443', confidence: 0.5 })?.applianceType).toBe('unknown')
  })

  it('uses a model-number prefix only when that prefix is certain for one category', () => {
    // Smeg documents DI as Dishwasher Integrated (DI612). The rule is the prefix, not a model list.
    expect(normaliseIdentity({ applianceType: 'oven', manufacturer: 'Smeg', model: 'DI612C', confidence: 0.8 })?.applianceType).toBe('dishwasher')
    expect(normaliseIdentity({ applianceType: 'unknown', manufacturer: 'SMEG', model: 'DI 9999X', confidence: 0.4 })?.applianceType).toBe('dishwasher')
    expect(normaliseIdentity({ applianceType: 'oven', manufacturer: 'Other', model: 'DI612C', confidence: 0.8 })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ applianceType: 'oven', manufacturer: 'Smeg', model: 'SF64', confidence: 0.8 })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ applianceType: 'oven', typeEvidence: 'Oven', manufacturer: 'Smeg', model: 'DI612C', confidence: 0.8 })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ applianceType: 'oven', typeEvidence: 'Dishwasher', manufacturer: 'Smeg', model: 'DI612C', confidence: 0.8 })?.applianceType).toBe('dishwasher')
  })

  it('coerces a missing applianceType to "unknown"', () => {
    expect(normaliseIdentity({ manufacturer: 'Bosch', model: 'X', confidence: 0.5 })?.applianceType).toBe('unknown')
  })
})
