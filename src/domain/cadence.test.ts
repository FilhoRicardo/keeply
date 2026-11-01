import { describe, expect, it } from 'vitest'
import { verifyQuote } from './evidence-check'
import {
  presentInterval,
  fitSourceQuoteForStorage,
  quoteWithPageCadence,
  readCadence,
  readCadenceFromContext,
  type CadenceReading,
} from './cadence'
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
  ['at least once every two months', { count: 2, unit: 'month' }],
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

const MORE_PHRASES: readonly [string, Interval][] = [
  ['once a day', { count: 1, unit: 'day' }],
  ['ONCE A DAY', { count: 1, unit: 'day' }],
  ['once-a-day', { count: 1, unit: 'day' }],
  ['once per day', { count: 1, unit: 'day' }],
  ['once per week', { count: 1, unit: 'week' }],
  ['once per month', { count: 1, unit: 'month' }],
  ['once per year', { count: 1, unit: 'year' }],
  ['Once Per Year', { count: 1, unit: 'year' }],
  ['once-per-day', { count: 1, unit: 'day' }],
  ['once-per-week', { count: 1, unit: 'week' }],
  ['once-per-month', { count: 1, unit: 'month' }],
  ['once-per-year', { count: 1, unit: 'year' }],
  ['every other day', { count: 2, unit: 'day' }],
  ['every other week', { count: 2, unit: 'week' }],
  ['every other month', { count: 2, unit: 'month' }],
  ['every other year', { count: 2, unit: 'year' }],
  ['Every Other Month', { count: 2, unit: 'month' }],
  ['every-other-day', { count: 2, unit: 'day' }],
  ['every-other-week', { count: 2, unit: 'week' }],
  ['every-other-month', { count: 2, unit: 'month' }],
  ['every-other-year', { count: 2, unit: 'year' }],
  ['fortnightly', { count: 2, unit: 'week' }],
  ['FORTNIGHTLY', { count: 2, unit: 'week' }],
  ['every fortnight', { count: 2, unit: 'week' }],
  ['Every Fortnight', { count: 2, unit: 'week' }],
  ['every-fortnight', { count: 2, unit: 'week' }],
  ['quarterly', { count: 3, unit: 'month' }],
  ['QUARTERLY', { count: 3, unit: 'month' }],
  ['half-yearly', { count: 6, unit: 'month' }],
  ['half yearly', { count: 6, unit: 'month' }],
  ['HALF-YEARLY', { count: 6, unit: 'month' }],
  ['Half Yearly', { count: 6, unit: 'month' }],
  ['semi-annually', { count: 6, unit: 'month' }],
  ['semiannually', { count: 6, unit: 'month' }],
  ['semi annually', { count: 6, unit: 'month' }],
  ['SEMI-ANNUALLY', { count: 6, unit: 'month' }],
  ['Semiannually', { count: 6, unit: 'month' }],
  ['biannually', { count: 6, unit: 'month' }],
  ['BIANNUALLY', { count: 6, unit: 'month' }],
  ['bi-annually', { count: 6, unit: 'month' }],
  ['bi annually', { count: 6, unit: 'month' }],
  ['twice a month', { count: 2, unit: 'week' }],
  ['Twice A Month', { count: 2, unit: 'week' }],
  ['twice-a-month', { count: 2, unit: 'week' }],
  ['twice per month', { count: 2, unit: 'week' }],
  ['twice-per-year', { count: 6, unit: 'month' }],
  ['2 times per year', { count: 6, unit: 'month' }],
  ['2 times per month', { count: 2, unit: 'week' }],
  ['two times a year', { count: 6, unit: 'month' }],
  ['2-times-per-year', { count: 6, unit: 'month' }],
  ['4 times per year', { count: 3, unit: 'month' }],
  ['3 times per year', { count: 4, unit: 'month' }],
  ['6 times a year', { count: 2, unit: 'month' }],
  ['12 times per year', { count: 1, unit: 'month' }],
  ['1 time per week', { count: 1, unit: 'week' }],
  ['one time per day', { count: 1, unit: 'day' }],
]

describe('readCadence additional stated phrases', () => {
  it.each(MORE_PHRASES)('reads "%s"', (phrase, interval) => {
    expect(readCadence(`Care instruction: ${phrase}.`)).toEqual(stated(interval))
  })

  it('uses the earliest cadence when several appear', () => {
    expect(readCadence('Clean it fortnightly, and descale it yearly.')).toEqual(stated({ count: 2, unit: 'week' }))
    expect(readCadence('Descale it yearly, and clean it fortnightly.')).toEqual(stated({ count: 1, unit: 'year' }))
    expect(readCadence('Clean twice a week and descale every 3 months.')).toEqual(unstated('twice a week'))
    expect(readCadence('Descale every 3 months and clean twice a week.')).toEqual(stated({ count: 3, unit: 'month' }))
  })

  it('lets a stated cadence win over a vague word that comes first', () => {
    expect(readCadence('Clean regularly, then service it quarterly.')).toEqual(stated({ count: 3, unit: 'month' }))
  })
})

describe('readCadence frequencies the interval cannot express', () => {
  it.each([
    ['Clean the filter twice a week.', 'twice a week'],
    ['Clean the filter Twice A Week.', 'Twice A Week'],
    ['Clean the filter twice-a-week.', 'twice-a-week'],
    ['Clean the filter twice per week.', 'twice per week'],
    ['Rinse it 2 times per week.', '2 times per week'],
    ['Rinse it 2-times-per-week.', '2-times-per-week'],
    ['Rinse it TWO TIMES PER WEEK.', 'TWO TIMES PER WEEK'],
    ['Rinse it 2 times a week.', '2 times a week'],
    ['Rinse it 3 times per day.', '3 times per day'],
    ['Rinse it three times per day.', 'three times per day'],
    ['Rinse it three-times-per-day.', 'three-times-per-day'],
    ['Rinse it 2 times per day.', '2 times per day'],
    ['Wipe it twice a day.', 'twice a day'],
    ['Descale three times a month.', 'three times a month'],
    ['Descale Three Times A Month.', 'Three Times A Month'],
    ['Descale three-times-a-month.', 'three-times-a-month'],
    ['Service it 4 times per month.', '4 times per month'],
    ['Service it 5 times per year.', '5 times per year'],
  ] as const)('quotes the manual wording in "%s"', (quote, wording) => {
    expect(readCadence(quote)).toEqual(unstated(wording))
  })

  it('prefers the frequency phrase over a vague word or a usage phrase', () => {
    expect(readCadence('Clean regularly, twice a week.')).toEqual(unstated('twice a week'))
    expect(readCadence('Wipe the seal after each use and clean twice a week.')).toEqual(unstated('twice a week'))
  })
})

describe('readCadence indicator-driven refills', () => {
  it('does not treat indicator refills as daily when the quote mentions an indicator', () => {
    expect(readCadence('refill salt every day when the indicator is on.')).toEqual(unstated('when the indicator'))
    expect(readCadence('refill the rinse aid dispenser when the indicator is on.')).toEqual(unstated('when the indicator'))
  })

  it('does not borrow a weekly cadence from an earlier bullet on the same page', () => {
    const page22 =
      '• wipe clean the door, including the rubber gasket, once a week. • refill salt when the indicator is on. keep rinse aid topped up.'
    expect(readCadenceFromContext('refill salt when the indicator is on.', page22)).toEqual(unstated('when the indicator'))
  })

  it('does not borrow a daily cadence from another bullet when the salt quote is indicator-driven', () => {
    const page26 =
      '• use a descaler or a cleaning product designed specifically for dishwashers every day. • refill salt when the indicator is on. keep the rinse aid dispenser topped up when the indicator is on.'
    expect(readCadenceFromContext('refill salt when the indicator is on.', page26)).toEqual(unstated('when the indicator'))
  })

  it('does not treat a widened indicator salt quote as daily when another bullet mentions every day', () => {
    const widened =
      'use a descaler or a cleaning product designed specifically for dishwashers every day. refill salt when the indicator is on.'
    expect(readCadence(widened)).toEqual(unstated('when the indicator'))
  })
})

describe('readCadenceFromContext', () => {
  it('reads cadence from page text near the quote when the quote omits it', () => {
    const page22 =
      '• do not use abrasive products. • wipe clean the door, including the rubber gasket, once a week. • to maintain the performance of your appliance, use a cleaning product designed specifically for dishwashers at least once every two months. carefully follow the instructions on the packaging of the product. • for optimal cleaning results, start the programme machine care.'
    expect(
      readCadenceFromContext('for optimal cleaning results, start the programme machine care.', page22),
    ).toEqual(stated({ count: 2, unit: 'month' }))
  })

  it('widens a short quote to a verified span that includes the schedule phrase', () => {
    const page =
      '• use a cleaning product designed specifically for dishwashers at least once every two months. • for optimal cleaning results, start the programme machine care.'
    const widened = quoteWithPageCadence('for optimal cleaning results, start the programme machine care.', page)
    expect(widened).toMatch(/at least once every two months/i)
    expect(widened).toMatch(/machine care/i)
  })

  it('prefers cadence in the quote over nearby page text', () => {
    const page22 =
      '• do not use abrasive products. • wipe clean the door, including the rubber gasket, once a week. • to maintain the performance of your appliance, use a cleaning product designed specifically for dishwashers at least once every two months. • for optimal cleaning results, start the programme machine care.'
    expect(readCadenceFromContext('wipe clean the door, including the rubber gasket, once a week.', page22)).toEqual(
      stated({ count: 1, unit: 'week' }),
    )
  })
})

describe('fitSourceQuoteForStorage', () => {
  it('clamps an over-long verified quote on a word boundary at the DB limit', () => {
    const tail = 'Clean the filter once a month under running water.'
    const padding = 'word '.repeat(220).trim()
    const page = `${padding} ${tail}`
    const overLong = `${padding} ${tail}`
    expect(overLong.length).toBeGreaterThan(1000)
    const fitted = fitSourceQuoteForStorage(overLong, page, tail)
    expect(fitted.length).toBeLessThanOrEqual(1000)
    expect(fitted.trim().length).toBeGreaterThan(0)
    expect(fitted.endsWith('water.')).toBe(true)
    expect(verifyQuote(page, fitted)).toBe(true)
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

  it('uses page text near the quote when presenting an interval', () => {
    const page =
      'use a cleaning product designed specifically for dishwashers at least once every two months. start the programme machine care.'
    expect(
      presentInterval({
        quote: 'start the programme machine care.',
        stored: { count: 1, unit: 'month' },
        generalGuidance: false,
        pageText: page,
      }),
    ).toEqual({ interval: { count: 2, unit: 'month' }, text: 'Every 2 months · from the manual' })
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

  it('labels a newly recognised cadence as from the manual', () => {
    expect(
      presentInterval({
        quote: 'Have the appliance serviced quarterly.',
        stored: { count: 1, unit: 'month' },
        generalGuidance: false,
      }),
    ).toEqual({ interval: { count: 3, unit: 'month' }, text: 'Every 3 months · from the manual' })
  })

  it('quotes a sub-unit frequency instead of saying the manual is silent', () => {
    expect(
      presentInterval({
        quote: 'Clean the filter twice a week.',
        stored: { count: 1, unit: 'week' },
        generalGuidance: false,
      }),
    ).toEqual({
      interval: { count: 1, unit: 'month' },
      text: 'Every month · Keeply\'s suggestion. The manual says "twice a week".',
    })
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
