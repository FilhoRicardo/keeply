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
      applianceType: 'unknown',
      manufacturer: 'Bosch',
      model: null,
      serialNumber: null,
      confidence: 0,
    })
    expect(normaliseIdentity('nope')).toBeNull()
  })
})
