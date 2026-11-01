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
    expect(IDENTITY_INSTRUCTIONS).toMatch(/do not guess a category from the picture/i)
  })

  it('asks for the visible parts without asking the model to name the category from them', () => {
    expect(IDENTITY_INSTRUCTIONS).toContain('"visibleParts": string[]')
    expect(IDENTITY_INSTRUCTIONS).toContain('plainly see outside the label')
    expect(IDENTITY_INSTRUCTIONS).toContain('Do not name the appliance or its category there')
    expect(IDENTITY_INSTRUCTIONS).toContain('Use [] when none are clearly visible')
  })

  it('does not offer an example category or part', () => {
    const prompt = IDENTITY_INSTRUCTIONS.toLowerCase()
    for (const word of ['oven', 'dishwasher', 'fridge', 'rack', 'basket', 'drum']) expect(prompt).not.toContain(word)
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

  it('names the category from listed parts that belong to one kind of appliance', () => {
    const plate = { applianceType: 'unknown', typeEvidence: null, manufacturer: 'Electrolux', model: 'KEQB7300L', serialNumber: '04130146', confidence: 0.95 }
    expect(normaliseIdentity({ ...plate, visibleParts: ['Dish racks above the label'] })).toEqual({
      applianceType: 'dishwasher',
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
      serialNumber: '04130146',
      confidence: 0.95,
    })
    expect(normaliseIdentity({ ...plate, visibleParts: ['wire racks', 'cutlery basket', 'spray arm'] })?.applianceType).toBe('dishwasher')
    expect(normaliseIdentity({ ...plate, applianceType: 'Dishwasher', visibleParts: ['plate racks'] })?.applianceType).toBe('dishwasher')
    expect(normaliseIdentity({ ...plate, visibleParts: ['lint filter'] })?.applianceType).toBe('dryer')
    expect(normaliseIdentity({ ...plate, applianceType: 'Tumble dryer', visibleParts: ['lint filter'] })?.applianceType).toBe('tumble dryer')
  })

  it('returns unknown when the listed parts are shared, conflicting or missing', () => {
    const plate = { applianceType: 'unknown', typeEvidence: null, manufacturer: 'Electrolux', model: 'KEQB7300L', confidence: 0.95 }
    // Parts several kinds of appliance share are not evidence.
    for (const part of ['wire racks', 'metal rack', 'drum', 'interior shelf', 'stainless steel door', 'grey panel']) {
      expect(normaliseIdentity({ ...plate, visibleParts: [part] })?.applianceType).toBe('unknown')
    }
    expect(normaliseIdentity({ ...plate, visibleParts: ['rinse aid compartment label'] })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ ...plate, visibleParts: ['rinse aid dispenser'] })?.applianceType).toBe('unknown')
    // A category word is not a part.
    expect(normaliseIdentity({ ...plate, visibleParts: ['dishwasher'] })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ ...plate, visibleParts: ['oven racks'] })?.applianceType).toBe('unknown')
    // The free model's "oven" for a dishwasher plate conflicts with dish racks.
    expect(normaliseIdentity({ ...plate, applianceType: 'oven', visibleParts: ['dish racks'] })?.applianceType).toBe('unknown')
    // Parts of two kinds of appliance contradict each other.
    expect(normaliseIdentity({ ...plate, visibleParts: ['dish rack', 'detergent drawer'] })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ ...plate, visibleParts: [] })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ ...plate, visibleParts: 'dish racks' })?.applianceType).toBe('unknown')
    expect(normaliseIdentity({ ...plate, visibleParts: [42, null] })?.applianceType).toBe('unknown')
  })

  it('lets a printed category win over the listed parts', () => {
    const raw = { applianceType: 'washing machine', typeEvidence: 'Waschmaschine', visibleParts: ['dish racks'], manufacturer: 'Miele', confidence: 0.6 }
    expect(normaliseIdentity(raw)?.applianceType).toBe('washing machine')
    expect(normaliseIdentity({ ...raw, applianceType: 'oven', typeEvidence: 'oven dishwasher' })?.applianceType).toBe('unknown')
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
