import { describe, expect, it } from 'vitest'
import { presentInterval, readCadence, type CadenceReading } from './cadence'
import type { Interval } from './format-interval'

const stated = (interval: Interval): CadenceReading => ({ stated: true, interval })
const unstated = (wording: string | null): CadenceReading => ({ stated: false, wording })

const PHRASES: readonly [string, Interval][] = [
  ['daily', { count: 1, unit: 'day' }],
  ['every day', { count: 1, unit: 'day' }],
  ['each day', { count: 1, unit: 'day' }],
  ['weekly', { count: 1, unit: 'week' }],
  ['every week', { count: 1, unit: 'week' }],
  ['once a week', { count: 1, unit: 'week' }],
  ['monthly', { count: 1, unit: 'month' }],
  ['every month', { count: 1, unit: 'month' }],
  ['once a month', { count: 1, unit: 'month' }],
  ['yearly', { count: 1, unit: 'year' }],
  ['annually', { count: 1, unit: 'year' }],
  ['every year', { count: 1, unit: 'year' }],
  ['once a year', { count: 1, unit: 'year' }],
  ['twice a year', { count: 6, unit: 'month' }],
  ['every 14 days', { count: 14, unit: 'day' }],
  ['every 2 weeks', { count: 2, unit: 'week' }],
  ['every 3 months', { count: 3, unit: 'month' }],
  ['every 4 years', { count: 4, unit: 'year' }],
  ['every 18 months', { count: 18, unit: 'month' }],
]

describe('readCadence stated cadences', () => {
  it.each(PHRASES)('reads "%s"', (phrase, interval) => {
    expect(readCadence(`Care instruction: ${phrase}.`)).toEqual(stated(interval))
  })

  it.each(['DAILY', 'Every Month', 'TWICE A YEAR', 'Once a Week'] as const)('is case-insensitive for "%s"', (phrase) => {
    expect(readCadence(phrase).stated).toBe(true)
  })

  const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'] as const

  it.each(words)('reads the word number "%s"', (word) => {
    const count = words.indexOf(word) + 1
    expect(readCadence(`Service the appliance every ${word} months.`)).toEqual(stated({ count, unit: 'month' }))
  })

  it('reads word numbers for days, weeks and years', () => {
    expect(readCadence('Clean it every two days.')).toEqual(stated({ count: 2, unit: 'day' }))
    expect(readCadence('Clean it every four weeks.')).toEqual(stated({ count: 4, unit: 'week' }))
    expect(readCadence('Clean it every six years.')).toEqual(stated({ count: 6, unit: 'year' }))
  })

  it('uses the quote when its cadence disagrees with the AI interval', () => {
    const aiInterval: Interval = { count: 1, unit: 'month' }
    const reading = readCadence('Descale the machine every 3 months.')
    expect(reading).toEqual(stated({ count: 3, unit: 'month' }))
    expect(reading).not.toEqual(stated(aiInterval))
  })

  it('lets a stated cadence win over a vague word in the same quote', () => {
    expect(readCadence('Clean the filter regularly, every 3 months.')).toEqual(stated({ count: 3, unit: 'month' }))
  })

  it('lets a stated cadence win over a usage phrase in the same quote', () => {
    expect(readCadence('Wipe the door after each use and clean the filter daily.')).toEqual(stated({ count: 1, unit: 'day' }))
  })
})

describe('readCadence when the quote states no time cadence', () => {
  it.each(['regularly', 'periodically', 'when necessary', 'if necessary', 'from time to time'] as const)(
    'quotes the vague word "%s"',
    (wording) => {
      expect(readCadence(`Clean the spray arm ${wording}.`)).toEqual(unstated(wording))
    },
  )

  it('preserves the quote’s own capitalisation', () => {
    expect(readCadence('Clean it Regularly.')).toEqual(unstated('Regularly'))
  })

  it.each([
    ['Wipe the seal after each use.', 'after each use'],
    ['Rinse the filter after every wash.', 'after every wash'],
    ['Check the filters for residues after each wash.', 'after each wash'],
    ['Wipe the seal after every use.', 'after every use'],
    ['Descale every 5 washes.', 'every 5 washes'],
    ['Run it every three cycles.', 'every three cycles'],
    ['Run it every twelve washes.', 'every twelve washes'],
  ] as const)('quotes the usage phrase in "%s"', (quote, wording) => {
    expect(readCadence(quote)).toEqual(unstated(wording))
  })

  it('prefers a usage phrase over a vague word when the quote has both', () => {
    expect(readCadence('Clean regularly after each use.')).toEqual(unstated('after each use'))
  })

  it('returns not stated when the quote has no cadence and no vague word', () => {
    expect(readCadence('Clean the spray arm with a soft brush.')).toEqual(unstated(null))
  })

  it('does not treat a word number above twelve as a stated cadence', () => {
    expect(readCadence('Service the appliance every eighteen months.')).toEqual(unstated(null))
  })

  it('does not treat every 0 months as a cadence', () => {
    expect(readCadence('Service the appliance every 0 months.')).toEqual(unstated(null))
  })
})

describe('presentInterval', () => {
  it('labels a stated cadence as from the manual and ignores a different stored interval', () => {
    expect(
      presentInterval({
        quote: 'Descale the machine every 3 months.',
        stored: { count: 1, unit: 'month' },
        generalGuidance: false,
      }),
    ).toEqual({ interval: { count: 3, unit: 'month' }, text: 'Every 3 months · from the manual' })
  })

  it('labels an unstated quote as Keeply’s suggestion and quotes the manual’s word', () => {
    expect(
      presentInterval({
        quote: 'Clean the lower spray arm regularly to prevent clogging.',
        stored: { count: 2, unit: 'week' },
        generalGuidance: false,
      }),
    ).toEqual({
      interval: { count: 1, unit: 'month' },
      text: 'Every month · Keeply\'s suggestion. The manual says "regularly".',
    })
  })

  it('quotes a usage phrase as the manual’s wording', () => {
    expect(
      presentInterval({
        quote: 'Wipe the seal after each use.',
        stored: { count: 1, unit: 'week' },
        generalGuidance: false,
      }).text,
    ).toBe('Every month · Keeply\'s suggestion. The manual says "after each use".')
  })

  it('says when the manual does not say how often', () => {
    expect(
      presentInterval({
        quote: 'Clean the spray arm with a soft brush.',
        stored: { count: 1, unit: 'week' },
        generalGuidance: false,
      }).text,
    ).toBe("Every month · Keeply's suggestion. The manual does not say how often.")
  })

  it('keeps a built-in general-guidance interval and its current label', () => {
    expect(
      presentInterval({
        quote: null,
        stored: { count: 3, unit: 'month' },
        generalGuidance: true,
      }),
    ).toEqual({ interval: { count: 3, unit: 'month' }, text: 'Every 3 months' })
  })
})
