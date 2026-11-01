import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { presentInterval, quoteWithPageCadence, readCadenceFromContext } from '@/domain/cadence'
import {
  maintenanceComponentKey,
  mergeExtractedTasks,
  normaliseExtraction,
  type ExtractedPage,
  type ExtractedTaskCandidate,
} from './extraction'

const fixturePath = fileURLToPath(new URL('../test-fixtures/electrolux-keqb7300l-care-pages.json', import.meta.url))
const carePages = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExtractedPage[]
const pageTextByNumber = new Map<number, string>(carePages.map((p) => [p.page, p.text] as const))
const pageNumbers = new Set(carePages.map((p) => p.page))
const readCadence = (quote: string, pageText?: string, task?: string) => readCadenceFromContext(quote, pageText, task)

const MACHINE_CARE_QUOTE =
  'to maintain the performance of your appliance, use a cleaning product designed specifically for dishwashers at least once every two months. carefully follow the instructions on the packaging of the product. for optimal cleaning results, start the programme machine care.'
const MACHINE_CARE_INDICATOR = 'when the appliance senses the need for cleaning, the indicator is on.'
const filterIntro =
  'dirty filters and clogged spray arms negatively affect the washing results. check these elements regularly and, if necessary, clean them.'
const doorQuote = 'wipe clean the door, including the rubber gasket, once a week.'
const lowerArm = 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.'
const saltQuote = 'salt indicator. it is on when the salt container needs refilling.'
const rinseQuote = 'rinse aid indicator. it is on when the rinse aid dispenser needs refilling.'

/** Noisy prod-like model output for the KEQB7300L care section (real manual pages in fixture). */
const noisyModelCandidates: ExtractedTaskCandidate[] = [
  {
    task: 'Refill rinse aid dispenser',
    instructions: 'Top up when the indicator shows.',
    interval: { count: 1, unit: 'day' },
    page: 9,
    quote: rinseQuote,
  },
  {
    task: 'Refill rinse aid',
    instructions: 'Fill when empty.',
    interval: { count: 1, unit: 'month' },
    page: 17,
    quote: rinseQuote,
  },
  {
    task: 'Check and refill salt container',
    instructions: 'Refill when needed.',
    interval: { count: 1, unit: 'day' },
    page: 9,
    quote: saltQuote,
  },
  {
    task: 'Refill salt container',
    instructions: 'Use dishwasher salt.',
    interval: { count: 1, unit: 'day' },
    page: 8,
    quote: 'the salt is used to recharge the resin in the water softener and to assure good washing results in daily use.',
  },
  {
    task: 'Run Machine Care programme',
    instructions: 'Run when the indicator is on.',
    interval: { count: 1, unit: 'day' },
    page: 21,
    quote: MACHINE_CARE_INDICATOR,
  },
  {
    task: 'Run Machine Care programme with descaler or cleaning product',
    instructions: 'Use dishwasher cleaner.',
    interval: { count: 2, unit: 'month' },
    page: 22,
    quote: MACHINE_CARE_QUOTE,
  },
  {
    task: 'Run Machine Care programme with descaler',
    instructions: 'Daily descaler line from a bad chunk.',
    interval: { count: 1, unit: 'day' },
    page: 22,
    quote: 'use a descaler or a cleaning product designed specifically for dishwashers every day.',
  },
  {
    task: 'Check and clean filters',
    instructions: 'Clean if needed.',
    interval: { count: 1, unit: 'month' },
    page: 21,
    quote: filterIntro,
  },
  {
    task: 'Clean the filters',
    instructions: 'Wrong quote from door task.',
    interval: { count: 1, unit: 'week' },
    page: 22,
    quote: doorQuote,
  },
  {
    task: 'Check and clean spray arms',
    instructions: 'Prevent clogs.',
    interval: { count: 1, unit: 'month' },
    page: 23,
    quote: lowerArm,
  },
  {
    task: 'Clean the lower spray arm',
    instructions: 'Rinse under water.',
    interval: { count: 1, unit: 'month' },
    page: 23,
    quote: lowerArm,
  },
  {
    task: 'Clean the door and rubber gasket',
    instructions: 'Wipe weekly.',
    interval: { count: 1, unit: 'week' },
    page: 22,
    quote: doorQuote,
  },
  {
    task: 'Check filters and sump for foreign objects',
    instructions: 'After each use.',
    interval: { count: 1, unit: 'week' },
    page: 22,
    quote: 'check the filters and the sump after each use of the dishwasher.',
  },
]

const EXPECTED_COMPONENTS = ['rinse-aid', 'salt', 'machine-care', 'filters', 'spray-arms', 'door-gasket'] as const

describe('Electrolux KEQB7300L real-manual golden pipeline', () => {
  it('normalises → merges → widens quotes → presents exactly six maintenance tasks', () => {
    const normalised = normaliseExtraction({ candidates: noisyModelCandidates }, pageNumbers)
    const merged = mergeExtractedTasks(normalised, { pageTextByNumber, readCadence })

    expect(merged).toHaveLength(6)
    expect([...new Set(merged.map((c) => maintenanceComponentKey(c)))].sort()).toEqual([...EXPECTED_COMPONENTS].sort())

    const byKey = new Map(merged.map((c) => [maintenanceComponentKey(c), c] as const))

    const present = (key: (typeof EXPECTED_COMPONENTS)[number]) => {
      const row = byKey.get(key)!
      const pageText = pageTextByNumber.get(row.page)!
      const storedQuote = quoteWithPageCadence(row.quote, pageText, row.task)
      return {
        row,
        storedQuote,
        display: presentInterval({
          quote: storedQuote,
          stored: row.interval,
          generalGuidance: false,
          pageText,
          task: row.task,
        }),
      }
    }

    const rinse = present('rinse-aid')
    expect(rinse.display.text).toMatch(/Keeply's suggestion/)
    expect(rinse.display.text).toMatch(/it is on when|indicator/i)
    expect(rinse.display.text).not.toMatch(/from the manual/)

    const salt = present('salt')
    expect(salt.display.text).toMatch(/Keeply's suggestion/)
    expect(salt.display.text).toMatch(/it is on when|indicator/i)
    expect(salt.display.text).not.toMatch(/Every day · from the manual/)
    expect(salt.display.text).not.toMatch(/from the manual/)

    const machineCare = present('machine-care')
    expect(machineCare.display.interval).toEqual({ count: 2, unit: 'month' })
    expect(machineCare.display.text).toMatch(/Every 2 months · from the manual/)
    expect(machineCare.storedQuote).toMatch(/at least once every two months/i)
    expect(machineCare.storedQuote).toMatch(/machine care/i)

    const filters = present('filters')
    expect(filters.display.text).toMatch(/Keeply's suggestion/)
    expect(filters.display.text).toMatch(/regularly/i)
    expect(filters.row.quote).toMatch(/regularly/i)

    const sprayArms = present('spray-arms')
    expect(sprayArms.display.text).toMatch(/Keeply's suggestion/)
    expect(sprayArms.display.text).toMatch(/regularly/i)

    const door = present('door-gasket')
    expect(door.display.interval).toEqual({ count: 1, unit: 'week' })
    expect(door.display.text).toMatch(/Every week · from the manual/)
    expect(door.storedQuote).toMatch(/rubber gasket/i)
  })
})
