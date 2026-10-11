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
  it('takes the category from printed words and otherwise says unknown', () => {
    expect(IDENTITY_INSTRUCTIONS).toContain('"typeEvidence"')
    expect(IDENTITY_INSTRUCTIONS).toContain('printed type text')
    expect(IDENTITY_INSTRUCTIONS).toContain('product-category word')
    expect(IDENTITY_INSTRUCTIONS).toContain('model-number prefix')
    expect(IDENTITY_INSTRUCTIONS).toContain('only when you are certain')
    expect(IDENTITY_INSTRUCTIONS).toContain('"unknown"')
    expect(IDENTITY_INSTRUCTIONS).toMatch(/do not guess a category/i)
  })

  it('does not offer oven as an example category', () => {
    expect(IDENTITY_INSTRUCTIONS.toLowerCase()).not.toContain('oven')
  })
})

describe('normaliseIdentity', () => {
  it('maps unknown types and junk fields safely', () => {
    expect(
      normaliseIdentity({
        applianceType: 'washing machine',
        typeEvidence: 'Washing machine',
        manufacturer: ' Bosch ',
        model: 42,
        confidence: 'high',
      }),
    ).toEqual({
      applianceType: 'washing machine',
      manufacturer: 'Bosch',
      model: null,
      serialNumber: null,
      confidence: 0,
    })
    expect(normaliseIdentity('nope')).toBeNull()
  })

  it('keeps a category the label quote supports', () => {
    expect(
      normaliseIdentity({ applianceType: 'Fridge', typeEvidence: 'Refrigerator', manufacturer: 'LG', model: 'LRFXS2503S', confidence: 0.7 })
        ?.applianceType,
    ).toBe('fridge')
    expect(
      normaliseIdentity({
        applianceType: 'Washing Machine',
        typeEvidence: 'Washing machine',
        manufacturer: 'Miele',
        model: 'WSD663',
        confidence: 0.6,
      })?.applianceType,
    ).toBe('washing machine')
    expect(
      normaliseIdentity({ applianceType: 'Oven', typeEvidence: 'Built-in oven', manufacturer: 'Bosch', model: 'HBL8443', confidence: 0.55 })
        ?.applianceType,
    ).toBe('oven')
    expect(normaliseIdentity({ applianceType: 'coffee machine', typeEvidence: 'Coffee machine', confidence: 0.4 })?.applianceType).toBe(
      'coffee machine',
    )
  })

  it('uses the printed category when the model guessed a different one', () => {
    expect(
      normaliseIdentity({
        applianceType: 'oven',
        typeEvidence: 'LAVASTOVIGLIE',
        manufacturer: 'Smeg',
        model: 'DI6012-1',
        confidence: 0.9,
      })?.applianceType,
    ).toBe('dishwasher')
    expect(
      normaliseIdentity({ applianceType: 'oven', typeEvidence: 'Microwave oven', manufacturer: 'Bosch', model: 'BFL523MS0B', confidence: 0.8 })
        ?.applianceType,
    ).toBe('microwave')
  })

  it('returns unknown when the quote does not name one category', () => {
    expect(normaliseIdentity({ applianceType: 'oven', manufacturer: 'Bosch', model: 'HBL8443', confidence: 0.55 })?.applianceType).toBe(
      'unknown',
    )
    expect(normaliseIdentity({ applianceType: 'oven', typeEvidence: 'HBL8443', model: 'HBL8443', confidence: 0.9 })?.applianceType).toBe(
      'unknown',
    )
    expect(
      normaliseIdentity({ applianceType: 'oven', typeEvidence: 'oven dishwasher', manufacturer: 'X', model: '1', confidence: 0.4 })?.applianceType,
    ).toBe('unknown')
    expect(normaliseIdentity({ manufacturer: 'Bosch', model: 'X', confidence: 0.5 })?.applianceType).toBe('unknown')
  })

  it('does not treat a model number as a category, including the reported dishwasher plates', () => {
    for (const model of ['KEQB7300L', 'DI6012-1']) {
      expect(
        normaliseIdentity({ applianceType: 'oven', manufacturer: 'X', model, typeEvidence: model, confidence: 0.95 })?.applianceType,
      ).toBe('unknown')
    }
  })

  it('uses a model-number prefix only when that prefix is certain and the quote includes the model', () => {
    const raw = { applianceType: 'oven', manufacturer: 'Bosch', model: 'HBL8443', typeEvidence: 'HBL8443', confidence: 0.6 }
    const certain = [{ prefix: 'HBL', category: 'oven' }]
    expect(normaliseIdentity(raw, certain)?.applianceType).toBe('oven')
    expect(normaliseIdentity({ ...raw, typeEvidence: null }, certain)?.applianceType).toBe('unknown')
    expect(normaliseIdentity(raw, [{ prefix: 'HB', category: 'oven' }])?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ ...raw, model: 'SMS6ZCI49E' }, certain)?.applianceType).toBe('unknown')
  })
})
