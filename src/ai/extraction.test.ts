import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { presentInterval, quoteWithPageCadence, readCadenceFromContext } from '@/domain/cadence'
import {
  maintenanceComponentKey,
  mergeExtractedTasks,
  normaliseExtraction,
  parseExtractionReply,
  type ExtractedPage,
  type ExtractedTaskCandidate,
} from './extraction'

const PAGES = new Set([1, 2, 3])
const P2 = 'Run a cleaning cycle every three months to keep the interior fresh. Page two.'

const goodCandidate = (overrides: Partial<ExtractedTaskCandidate> = {}): ExtractedTaskCandidate => ({
  task: 'Clean the filter',
  instructions: 'Twist out the filter, rinse under warm water, refit.',
  interval: { count: 1, unit: 'month' },
  page: 1,
  quote: 'Clean the filter once a month under running water.',
  ...overrides,
})

describe('normaliseExtraction', () => {
  it('keeps a well-formed candidate', () => {
    expect(normaliseExtraction({ candidates: [goodCandidate()] }, PAGES)).toEqual([goodCandidate()])
  })

  it('drops a model interval that the quote does not state for indicator refills', () => {
    const candidates = normaliseExtraction(
      {
        candidates: [
          {
            task: 'Check and refill salt container',
            instructions: 'Refill when needed.',
            interval: { count: 1, unit: 'day' },
            page: 1,
            quote: 'Refill salt when the indicator is on.',
          },
        ],
      },
      PAGES,
    )
    expect(candidates).toEqual([
      goodCandidate({
        task: 'Check and refill salt container',
        instructions: 'Refill when needed.',
        interval: { count: 1, unit: 'month' },
        quote: 'Refill salt when the indicator is on.',
      }),
    ])
  })

  it('trims and collapses whitespace in strings', () => {
    const result = normaliseExtraction(
      { candidates: [goodCandidate({ task: '  Clean the\n\tfilter  ', quote: '  Clean   the  filter once  a month.  ' })] },
      PAGES,
    )
    expect(result[0]?.task).toBe('Clean the filter')
    expect(result[0]?.quote).toBe('Clean the filter once a month.')
  })

  it('drops a candidate with a non-numeric, non-integer, or out-of-range page that was not sent', () => {
    expect(normaliseExtraction({ candidates: [goodCandidate({ page: 4 })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ page: 0 })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ page: -1 })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ page: 1.5 })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ page: '1' as unknown as number })] }, PAGES)).toEqual([])
  })

  it('drops a candidate with an empty task, instructions, or quote', () => {
    expect(normaliseExtraction({ candidates: [goodCandidate({ task: '' })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ task: '   ' })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ instructions: '' })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ quote: '' })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ quote: '   \n  ' })] }, PAGES)).toEqual([])
  })

  it('caps task and instructions length to reject runaway model output', () => {
    expect(normaliseExtraction({ candidates: [goodCandidate({ task: 'x'.repeat(201) })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ instructions: 'y'.repeat(1001) })] }, PAGES)).toEqual([])
  })

  it('drops a candidate with an invalid interval count or unit', () => {
    expect(normaliseExtraction({ candidates: [goodCandidate({ interval: { count: 0, unit: 'month' } })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ interval: { count: -1, unit: 'month' } })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ interval: { count: 1.5, unit: 'month' } })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ interval: { count: 366, unit: 'day' } })] }, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: [goodCandidate({ interval: { count: 1, unit: 'fortnight' as unknown as ExtractedTaskCandidate['interval']['unit'] } })] }, PAGES)).toEqual([])
  })

  it('keeps a candidate with an empty missing-key item but still returns the good ones', () => {
    const junk = [null, 'string', 42, undefined, true, [], { task: 'No instructions here' }]
    expect(normaliseExtraction({ candidates: [goodCandidate(), ...junk] }, PAGES)).toEqual([goodCandidate()])
  })

  it('returns an empty list when the wrapper has no candidates array, never throws', () => {
    expect(normaliseExtraction({}, PAGES)).toEqual([])
    expect(normaliseExtraction({ candidates: 'oops' }, PAGES)).toEqual([])
    expect(normaliseExtraction(null, PAGES)).toEqual([])
    expect(normaliseExtraction('garbage', PAGES)).toEqual([])
  })

  it('returns an empty list when every candidate is malformed, never throws', () => {
    const raw = { candidates: [{ task: '' }, { page: 99 }, null, { interval: { count: 0, unit: 'day' } }] }
    expect(normaliseExtraction(raw, PAGES)).toEqual([])
  })

  it('keeps every well-formed candidate from a realistic manual extraction reply', () => {
    const pages = new Set([29, 30, 31])
    const list = [
      goodCandidate({
        task: 'Wipe the door gasket',
        page: 29,
        quote: 'Wipe the door gasket weekly with a damp cloth.',
        interval: { count: 1, unit: 'week' },
      }),
      goodCandidate({
        task: 'Clean the fine filter',
        page: 30,
        quote: 'Rinse the fine filter every month.',
        interval: { count: 1, unit: 'month' },
      }),
      goodCandidate({
        task: 'Check spray arms',
        page: 30,
        quote: 'Check spray arms every six months.',
        interval: { count: 6, unit: 'month' },
      }),
      goodCandidate({
        task: 'Run descaling',
        page: 31,
        quote: 'Run descaling every three months.',
        interval: { count: 3, unit: 'month' },
      }),
      goodCandidate({
        task: 'Refill salt and rinse aid',
        page: 31,
        quote: 'Refill salt and rinse aid when indicators show.',
        interval: { count: 1, unit: 'month' },
      }),
    ]
    expect(normaliseExtraction({ candidates: list }, pages)).toEqual(list)
  })

  it('keeps multiple good candidates from the same model reply', () => {
    const list = [
      goodCandidate({ task: 'Clean the filter', page: 1, quote: 'Clean the filter once a month under running water.', interval: { count: 1, unit: 'month' } }),
      goodCandidate({ task: 'Run a cleaning cycle', page: 2, quote: 'Run a cleaning cycle every three months.', interval: { count: 3, unit: 'month' } }),
      goodCandidate({ task: 'Check the spray arms', page: 3, quote: 'Check the spray arms every 6 months.', interval: { count: 6, unit: 'month' } }),
    ]
    expect(normaliseExtraction({ candidates: list }, PAGES)).toEqual(list)
  })
})

describe('maintenanceComponentKey', () => {
  const filterIntro =
    'dirty filters and clogged spray arms negatively affect the washing results. check these elements regularly and, if necessary, clean them.'

  it('groups filter tasks by task title even when the shared intro quote mentions spray arms', () => {
    expect(
      maintenanceComponentKey(
        goodCandidate({ task: 'Check and clean filters', quote: filterIntro, page: 21 }),
      ),
    ).toBe('filters')
    expect(maintenanceComponentKey(goodCandidate({ task: 'Clean filters', quote: filterIntro, page: 21 }))).toBe('filters')
  })

  it('groups multi-component tasks by the primary component named in the task title', () => {
    expect(
      maintenanceComponentKey(
        goodCandidate({
          task: 'Clean spray arm jets and filter',
          quote: 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.',
          page: 23,
        }),
      ),
    ).toBe('spray-arms')
  })

  it('groups spray-arm tasks when the title uses the plural spray arms', () => {
    expect(
      maintenanceComponentKey(
        goodCandidate({
          task: 'Check and clean spray arms',
          quote: 'check the spray arms regularly.',
          page: 23,
        }),
      ),
    ).toBe('spray-arms')
  })
})

describe('mergeExtractedTasks', () => {
  it('keys Clean the spray arms separately from filter maintenance', () => {
    expect(
      maintenanceComponentKey(
        goodCandidate({
          task: 'Clean the spray arms',
          quote: 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.',
          instructions: 'Clear holes.',
          page: 23,
        }),
      ),
    ).toBe('spray-arms')
  })

  it('keeps distinct filter and spray-arm tasks from the openrouter merge fixture', () => {
    const filterIntro =
      'dirty filters and clogged spray arms negatively affect the washing results. check these elements regularly and, if necessary, clean them.'
    const merged = mergeExtractedTasks(
      [
        goodCandidate({ task: 'Clean the filters', quote: filterIntro, page: 22, instructions: 'Rinse filters.' }),
        goodCandidate({
          task: 'Wipe the door gasket',
          quote: 'wipe clean the door, including the rubber gasket, once a week.',
          page: 22,
          instructions: 'Wipe weekly.',
          interval: { count: 1, unit: 'week' },
        }),
        goodCandidate({
          task: 'Run Machine Care with dishwasher cleaner',
          quote: 'for optimal cleaning results, start the programme machine care.',
          page: 22,
          instructions: 'Run Machine Care.',
        }),
        goodCandidate({
          task: 'Clean the spray arms',
          quote: 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.',
          page: 23,
          instructions: 'Clear holes.',
        }),
      ],
      { readCadence: (quote) => ({ stated: /once a week|every two months|every month/i.test(quote) }) },
    )
    expect(merged).toHaveLength(4)
    expect(merged.map((c) => c.task).sort()).toEqual([
      'Clean the filters',
      'Clean the spray arms',
      'Run Machine Care with dishwasher cleaner',
      'Wipe the door gasket',
    ])
  })

  it('keeps one entry per normalised task name and prefers a stated manual cadence', () => {
    const chunkA: ExtractedTaskCandidate[] = [
      goodCandidate({
        task: 'Clean the filters',
        quote: 'dirty filters and clogged spray arms negatively affect the washing results. check these elements regularly and, if necessary, clean them.',
        page: 21,
      }),
      goodCandidate({
        task: 'Wipe the door gasket',
        quote: 'wipe clean the door, including the rubber gasket, once a week.',
        page: 22,
        interval: { count: 1, unit: 'week' },
      }),
    ]
    const chunkB: ExtractedTaskCandidate[] = [
      goodCandidate({
        task: 'Run Machine Care with dishwasher cleaner',
        quote: 'for optimal cleaning results, start the programme machine care.',
        page: 22,
      }),
      goodCandidate({
        task: 'Clean the spray arms',
        quote: 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.',
        page: 23,
      }),
    ]
    const readCadence = (quote: string) => ({ stated: /once a week|every two months|every month/i.test(quote) })
    const merged = mergeExtractedTasks([...chunkA, ...chunkB], { readCadence })
    expect(merged.map((c) => c.task).sort()).toEqual([
      'Clean the filters',
      'Clean the spray arms',
      'Run Machine Care with dishwasher cleaner',
      'Wipe the door gasket',
    ])
    expect(merged.find((c) => c.task === 'Wipe the door gasket')?.interval).toEqual({ count: 1, unit: 'week' })
  })
})

describe('Electrolux KEQB7300L over-extraction consolidation', () => {
  const fixturePath = fileURLToPath(new URL('../test-fixtures/electrolux-keqb7300l-care-pages.json', import.meta.url))
  const carePages = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExtractedPage[]
  const page26SaltRinse =
    '• use a descaler or a cleaning product designed specifically for dishwashers every day. • refill salt when the indicator is on. keep the rinse aid dispenser topped up when the indicator is on.'
  const pageTextByNumber = new Map<number, string>([
    ...carePages.map((p) => [p.page, p.text] as const),
    [26, page26SaltRinse] as const,
  ])
  const readCadence = (quote: string, pageText?: string, task?: string) => readCadenceFromContext(quote, pageText, task)

  const filterIntro =
    'dirty filters and clogged spray arms negatively affect the washing results. check these elements regularly and, if necessary, clean them.'
  const doorQuote = 'wipe clean the door, including the rubber gasket, once a week.'
  const machineCareShort = 'for optimal cleaning results, start the programme machine care.'
  const machineCareFull =
    'to maintain the performance of your appliance, use a cleaning product designed specifically for dishwashers at least once every two months. carefully follow the instructions on the packaging of the product. for optimal cleaning results, start the programme machine care.'
  const lowerArm = 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.'
  const foreignObjects = 'check the filters and the sump after each use of the dishwasher.'
  const saltQuote = 'refill salt when the indicator is on.'
  const rinseQuote = 'keep the rinse aid dispenser topped up when the indicator is on.'

  const overExtracted: ExtractedTaskCandidate[] = [
    goodCandidate({ task: 'Refill rinse aid dispenser', page: 26, quote: rinseQuote, interval: { count: 1, unit: 'day' } }),
    goodCandidate({ task: 'Refill salt container', page: 26, quote: saltQuote, interval: { count: 1, unit: 'day' } }),
    goodCandidate({ task: 'Run Machine Care programme', page: 22, quote: machineCareShort, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Check and clean filters', page: 21, quote: filterIntro, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Check and clean spray arms', page: 23, quote: lowerArm, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Clean the door and rubber gasket', page: 22, quote: doorQuote, interval: { count: 1, unit: 'week' } }),
    goodCandidate({ task: 'Check filters and sump for foreign objects', page: 22, quote: foreignObjects, interval: { count: 1, unit: 'week' } }),
    goodCandidate({ task: 'Clean the filters', page: 22, quote: doorQuote, interval: { count: 1, unit: 'week' } }),
    goodCandidate({ task: 'Clean the lower spray arm', page: 23, quote: lowerArm, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Clean the upper spray arm', page: 24, quote: 'we recommend to clean the upper spray arm regularly to prevent soil from clogging the holes.', interval: { count: 1, unit: 'month' } }),
    goodCandidate({
      task: 'Clean the ceiling spray arm',
      page: 24,
      quote: 'we recommend to clean the ceiling spray arm regularly to prevent soil from clogging the holes.',
      interval: { count: 1, unit: 'month' },
    }),
    goodCandidate({ task: 'Clean filters', page: 21, quote: filterIntro, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Clean spray arm jets and filter', page: 23, quote: lowerArm, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Run Machine Care programme with descaler or cleaning product', page: 22, quote: machineCareFull, interval: { count: 1, unit: 'month' } }),
    goodCandidate({
      task: 'Run Machine Care programme with descaler',
      page: 22,
      quote: 'use a descaler or a cleaning product designed specifically for dishwashers every day.',
      interval: { count: 1, unit: 'day' },
    }),
  ]

  const prodNineExtracted: ExtractedTaskCandidate[] = [
    goodCandidate({ task: 'Refill rinse aid dispenser', page: 26, quote: rinseQuote, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Check and refill salt container', page: 26, quote: saltQuote, interval: { count: 1, unit: 'day' } }),
    goodCandidate({
      task: 'Run Machine Care programme with descaler or cleaning product',
      page: 22,
      quote: machineCareFull,
      interval: { count: 2, unit: 'month' },
    }),
    goodCandidate({ task: 'Check and clean filters', page: 21, quote: filterIntro, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Check and clean spray arms', page: 23, quote: lowerArm, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Clean the door and rubber gasket', page: 22, quote: doorQuote, interval: { count: 1, unit: 'week' } }),
    goodCandidate({ task: 'Check filters and sump for foreign objects', page: 22, quote: foreignObjects, interval: { count: 1, unit: 'week' } }),
    goodCandidate({ task: 'Clean spray arm jets and filter', page: 23, quote: lowerArm, interval: { count: 1, unit: 'month' } }),
    goodCandidate({ task: 'Clean filters', page: 21, quote: filterIntro, interval: { count: 1, unit: 'month' } }),
  ]

  it('does not keep a daily manual quote for the same salt task when an indicator quote exists', () => {
    const page26 =
      '• use a descaler or a cleaning product designed specifically for dishwashers every day. • refill salt when the indicator is on. keep the rinse aid dispenser topped up when the indicator is on.'
    const merged = mergeExtractedTasks(
      [
        goodCandidate({
          task: 'Check and refill salt container',
          page: 26,
          quote: 'use a descaler or a cleaning product designed specifically for dishwashers every day.',
          interval: { count: 1, unit: 'day' },
        }),
        goodCandidate({
          task: 'Check and refill salt container',
          page: 26,
          quote: saltQuote,
          interval: { count: 1, unit: 'day' },
        }),
      ],
      { pageTextByNumber: new Map([[26, page26]]), readCadence },
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]!.quote).toMatch(/indicator/i)
    expect(presentInterval({ quote: merged[0]!.quote, stored: merged[0]!.interval, generalGuidance: false }).text).not.toMatch(
      /from the manual/,
    )
  })

  it('runs normalise → merge → quote cadence → presentInterval for post-#78 prod wrong quotes', () => {
    const pageNumbers = new Set([...pageTextByNumber.keys()])
    const rawCandidates = [
      {
        task: 'Refill rinse aid',
        instructions: 'Top up when needed.',
        interval: { count: 1, unit: 'month' },
        page: 26,
        quote: rinseQuote,
      },
      {
        task: 'Check and refill salt container',
        instructions: 'Refill when the indicator is on.',
        interval: { count: 1, unit: 'day' },
        page: 26,
        quote: 'use a descaler or a cleaning product designed specifically for dishwashers every day.',
      },
      {
        task: 'Run Machine Care programme with descaler',
        instructions: 'Run the programme.',
        interval: { count: 1, unit: 'day' },
        page: 22,
        quote: 'use a descaler or a cleaning product designed specifically for dishwashers every day.',
      },
      {
        task: 'Run Machine Care programme with descaler or cleaning product',
        instructions: 'Use dishwasher cleaner.',
        interval: { count: 2, unit: 'month' },
        page: 22,
        quote: machineCareFull,
      },
    ]
    const normalised = normaliseExtraction({ candidates: rawCandidates }, pageNumbers)
    const merged = mergeExtractedTasks(normalised, { pageTextByNumber, readCadence })
    const byKey = new Map(merged.map((c) => [maintenanceComponentKey(c), c]))
    const saltStored = quoteWithPageCadence(byKey.get('salt')!.quote, pageTextByNumber.get(26)!, byKey.get('salt')!.task)
    expect(
      presentInterval({
        quote: saltStored,
        stored: byKey.get('salt')!.interval,
        generalGuidance: false,
        task: byKey.get('salt')!.task,
      }).text,
    ).toMatch(/Keeply's suggestion|indicator/i)
    expect(
      presentInterval({
        quote: saltStored,
        stored: byKey.get('salt')!.interval,
        generalGuidance: false,
        task: byKey.get('salt')!.task,
      }).text,
    ).not.toMatch(/Every day · from the manual/)
    const machineCare = byKey.get('machine-care')!
    const mcStored = quoteWithPageCadence(machineCare.quote, pageTextByNumber.get(22)!, machineCare.task)
    expect(
      presentInterval({
        quote: mcStored,
        stored: machineCare.interval,
        generalGuidance: false,
        pageText: pageTextByNumber.get(22),
        task: machineCare.task,
      }).interval,
    ).toEqual({ count: 2, unit: 'month' })
  })

  it('consolidates nine post-PR75 prod duplicates to six maintenance components with correct cadence', () => {
    const merged = mergeExtractedTasks(prodNineExtracted, { pageTextByNumber, readCadence })
    expect(merged).toHaveLength(6)
    expect(new Set(merged.map((c) => maintenanceComponentKey(c))).size).toBe(6)

    const byKey = new Map(merged.map((c) => [maintenanceComponentKey(c), c]))
    expect(byKey.get('salt')!.quote).toMatch(/indicator/i)
    expect(presentInterval({ quote: byKey.get('salt')!.quote, stored: { count: 1, unit: 'day' }, generalGuidance: false }).text).toMatch(/indicator/i)
    expect(presentInterval({ quote: byKey.get('salt')!.quote, stored: { count: 1, unit: 'day' }, generalGuidance: false }).text).not.toMatch(/from the manual/)
    expect(presentInterval({ quote: byKey.get('rinse-aid')!.quote, stored: { count: 1, unit: 'day' }, generalGuidance: false }).text).toMatch(/indicator/i)
    expect(
      presentInterval({
        quote: byKey.get('machine-care')!.quote,
        stored: { count: 1, unit: 'month' },
        generalGuidance: false,
        pageText: pageTextByNumber.get(22),
      }).interval,
    ).toEqual({ count: 2, unit: 'month' })
    expect(presentInterval({ quote: byKey.get('door-gasket')!.quote, stored: { count: 1, unit: 'month' }, generalGuidance: false, pageText: pageTextByNumber.get(22) }).interval).toEqual({
      count: 1,
      unit: 'week',
    })
    expect(presentInterval({ quote: byKey.get('filters')!.quote, stored: { count: 1, unit: 'week' }, generalGuidance: false }).text).toMatch(/Keeply's suggestion/)
    expect(presentInterval({ quote: byKey.get('spray-arms')!.quote, stored: { count: 1, unit: 'week' }, generalGuidance: false }).text).toMatch(/Keeply's suggestion/)
  })

  it('consolidates fifteen chunk duplicates to six maintenance components with correct cadence', () => {
    const merged = mergeExtractedTasks(overExtracted, { pageTextByNumber, readCadence })
    expect(merged).toHaveLength(6)
    expect(new Set(merged.map((c) => maintenanceComponentKey(c))).size).toBe(6)

    const byKey = new Map(merged.map((c) => [maintenanceComponentKey(c), c]))
    expect(presentInterval({ quote: byKey.get('door-gasket')!.quote, stored: { count: 1, unit: 'month' }, generalGuidance: false, pageText: pageTextByNumber.get(22) }).interval).toEqual({
      count: 1,
      unit: 'week',
    })
    expect(
      presentInterval({
        quote: byKey.get('machine-care')!.quote,
        stored: { count: 1, unit: 'month' },
        generalGuidance: false,
        pageText: pageTextByNumber.get(22),
      }).interval,
    ).toEqual({ count: 2, unit: 'month' })
    expect(presentInterval({ quote: byKey.get('filters')!.quote, stored: { count: 1, unit: 'week' }, generalGuidance: false }).text).toMatch(/Keeply's suggestion/)
    expect(presentInterval({ quote: byKey.get('spray-arms')!.quote, stored: { count: 1, unit: 'week' }, generalGuidance: false }).text).toMatch(/Keeply's suggestion/)
    expect(presentInterval({ quote: byKey.get('salt')!.quote, stored: { count: 1, unit: 'day' }, generalGuidance: false }).text).toMatch(/indicator/i)
    expect(presentInterval({ quote: byKey.get('rinse-aid')!.quote, stored: { count: 1, unit: 'day' }, generalGuidance: false }).text).toMatch(/indicator/i)
  })
})

describe('parseExtractionReply', () => {
  it('parses a clean JSON object reply', () => {
    const reply = JSON.stringify({ candidates: [goodCandidate()] })
    expect(parseExtractionReply(reply, PAGES)).toEqual([goodCandidate()])
  })

  it('parses a JSON reply wrapped in a code fence or in prose', () => {
    const fenced = '```json\n' + JSON.stringify({ candidates: [goodCandidate()] }) + '\n```'
    expect(parseExtractionReply(fenced, PAGES)).toEqual([goodCandidate()])
    const prose = 'Here you go:\n' + JSON.stringify({ candidates: [goodCandidate()] }) + '\nDone.'
    expect(parseExtractionReply(prose, PAGES)).toEqual([goodCandidate()])
  })

  it('returns an empty list and does not throw on unparseable input', () => {
    expect(parseExtractionReply('', PAGES)).toEqual([])
    expect(parseExtractionReply('I cannot extract from this.', PAGES)).toEqual([])
    expect(parseExtractionReply('{not json', PAGES)).toEqual([])
  })

  it('uses the provided pageNumbers to reject a candidate pointing at a page that was not sent', () => {
    const onlyPage1 = new Set([1])
    const reply = JSON.stringify({ candidates: [goodCandidate({ page: 2 })] })
    expect(parseExtractionReply(reply, onlyPage1)).toEqual([])
  })

  // Surface the three live page texts so the reader sees what shape pages take.
  it('round-trips real page texts used in the manual search pipeline', () => {
    const onlyP2 = new Set([2])
    const reply = JSON.stringify({
      candidates: [{ task: 'Run a cleaning cycle', instructions: 'Hottest cycle, dishwasher cleaner.', interval: { count: 3, unit: 'month' }, page: 2, quote: P2 }],
    })
    expect(parseExtractionReply(reply, onlyP2)).toHaveLength(1)
  })
})
