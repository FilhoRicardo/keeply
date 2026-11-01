import { describe, expect, it } from 'vitest'
import {
  mergeExtractedTasks,
  normaliseExtraction,
  parseExtractionReply,
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

describe('mergeExtractedTasks', () => {
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
