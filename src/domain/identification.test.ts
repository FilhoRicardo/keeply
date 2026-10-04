import { describe, expect, it } from 'vitest'
import { editIdentification, emptyIdentification, fitWithin, noRecognizer, validateIdentification } from './identification'

describe('identification', () => {
  it('recognises nothing in v0.1', async () => {
    expect(await noRecognizer.recognise(new Blob(['x']))).toBeNull()
  })

  it('makes any owner edit a manual identification', () => {
    const proposed = { ...emptyIdentification(), manufacturer: 'Bosh', confidence: 0.62, source: 'photo_recognition' as const }
    expect(editIdentification(proposed, { manufacturer: 'Bosch' })).toEqual({
      ...proposed,
      manufacturer: 'Bosch',
      confidence: null,
      source: 'manual',
    })
  })

  it('requires a manufacturer and a sane confidence', () => {
    expect(validateIdentification(emptyIdentification())).toMatch(/manufacturer/)
    expect(validateIdentification({ ...emptyIdentification(), manufacturer: 'Bosch', confidence: 1.4 })).toMatch(/Confidence/)
    expect(validateIdentification({ ...emptyIdentification(), manufacturer: 'Bosch' })).toBeNull()
  })
})

describe('fitWithin', () => {
  it.each([
    [4000, 3000, 1600, { width: 1600, height: 1200 }],
    [3000, 4000, 480, { width: 360, height: 480 }],
    [800, 600, 1600, { width: 800, height: 600 }],
  ])('%i×%i within %i', (w, h, max, expected) => {
    expect(fitWithin(w, h, max)).toEqual(expected)
  })
})
