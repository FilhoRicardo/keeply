import { describe, expect, it } from 'vitest'
import { extractJsonObject, normaliseIdentity } from './identity'

describe('extractJsonObject', () => {
  it('finds the object inside prose, fences and nested braces', () => {
    expect(extractJsonObject('Sure! {"a": {"b": "}"}, "c": 1} done')).toEqual({ a: { b: '}' }, c: 1 })
    expect(extractJsonObject('no json')).toBeNull()
    expect(extractJsonObject('{broken')).toBeNull()
    expect(extractJsonObject('The label reads {Bosch}: {"model": "X"}')).toEqual({ model: 'X' })
  })
})

describe('normaliseIdentity', () => {
  it('maps unknown types and junk fields safely', () => {
    expect(normaliseIdentity({ applianceType: 'washing machine', manufacturer: ' Bosch ', model: 42, confidence: 'high' })).toEqual({
      applianceType: 'washing machine',
      manufacturer: 'Bosch',
      model: null,
      serialNumber: null,
      confidence: 0,
    })
    expect(normaliseIdentity('nope')).toBeNull()
  })

  it('accepts any household appliance type the model returns', () => {
    // KEE-60: a fridge label is a valid appliance — the prompt is appliance-agnostic.
    expect(normaliseIdentity({ applianceType: 'Fridge', manufacturer: 'LG', model: 'LRFXS2503S', confidence: 0.7 })?.applianceType).toBe('fridge')
    expect(normaliseIdentity({ applianceType: 'Washing Machine', manufacturer: 'Miele', model: 'WSD663', confidence: 0.6 })?.applianceType).toBe('washing machine')
    expect(normaliseIdentity({ applianceType: 'Oven', manufacturer: 'Bosch', model: 'HBL8443', confidence: 0.55 })?.applianceType).toBe('oven')
  })

  it('coerces a missing applianceType to "unknown"', () => {
    expect(normaliseIdentity({ manufacturer: 'Bosch', model: 'X', confidence: 0.5 })?.applianceType).toBe('unknown')
  })
})
