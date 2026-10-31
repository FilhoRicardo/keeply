import { describe, expect, it, vi } from 'vitest'
import { presentInterval } from '@/domain/cadence'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import { proposePlan, type PlanDeps } from './plan-orchestration'

// KEE-42 acceptance: every step and every fallback has a fake-driven test. The orchestration
// depends only on its injected deps, so the test never reaches a network or a Supabase. The
// durable-counter test (the counter is checked BEFORE searchManuals) lives in
// supabase/tests/database/brave_quota.test.sql.

const BOSCH = 'Bosch'
const MODEL = 'SMS6ZCI49E'
const FAMILY = 'SMS6'
const BOSCH_DOMAIN = 'bosch-home.com'
const PDF_URL = `https://${BOSCH_DOMAIN}/docs/${MODEL}.pdf`
const PAGE_TEXT = `Care and cleaning\nClean the filter once a month under running water. ${MODEL}\nRemove the dishwasher filter every month under running water.`
const QUOTE = 'Remove the dishwasher filter every month under running water.'

function makeDeps(overrides: Partial<PlanDeps> = {}): PlanDeps {
  const controller = new AbortController()
  return {
    reserveBraveSearch: overrides.reserveBraveSearch ?? (async () => 'allowed'),
    searchManuals: overrides.searchManuals ?? (async () => ({ status: 'empty', candidates: [], reason: 'no_results' })),
    fetchDocument: overrides.fetchDocument ?? (async () => ({ ok: false, reason: 'fetch_failed' as const })),
    extractPages: overrides.extractPages ?? (async () => ({ ok: false, reason: 'unreadable' as const })),
    extractTasks: overrides.extractTasks ?? (async () => []),
    resolveSource: overrides.resolveSource ?? (() => ({ documentModels: [MODEL], documentFamily: FAMILY })),
    manufacturerDomains: overrides.manufacturerDomains ?? { bosch: [BOSCH_DOMAIN] },
    generalGuidance: overrides.generalGuidance ?? (() => GENERAL_DISHWASHER_TASKS),
    aiModel: overrides.aiModel ?? 'openrouter/free',
    signal: overrides.signal ?? controller.signal,
    scheduleTimeout: overrides.scheduleTimeout,
  }
}

function searchOkWith(url: string, title = 'PDF manual'): PlanDeps['searchManuals'] {
  return async () => ({ status: 'ok', candidates: [{ url, title, snippet: '', host: new URL(url).host }] })
}

function fetchOk(bytes: Uint8Array, type: 'pdf' | 'html' = 'html'): PlanDeps['fetchDocument'] {
  return async (url: string) => ({ ok: true, bytes, type, url })
}

function extractPagesOk(text = PAGE_TEXT, page = 1): PlanDeps['extractPages'] {
  return async () => ({ ok: true, pages: [{ page, text }] })
}

const CANDIDATE = {
  task: 'Clean the filter',
  instructions: 'Twist out the filter, rinse under warm water, refit.',
  interval: { count: 1, unit: 'month' as const },
  page: 1,
  quote: QUOTE,
}

function extractedTasksOk(tasks: readonly (typeof CANDIDATE)[]): PlanDeps['extractTasks'] {
  return async () => tasks as unknown as Awaited<ReturnType<PlanDeps['extractTasks']>>
}

describe('proposePlan', () => {
  it('walks the chain to a Manufacturer verified proposal when the manual is real', async () => {
    const searchSpy = vi.fn(searchOkWith(PDF_URL, 'Bosch SMS6 manual'))
    const reserveSpy = vi.fn(async () => 'allowed' as const)
    const fetchSpy = vi.fn(fetchOk(new TextEncoder().encode(PAGE_TEXT)))
    const extractPagesSpy = vi.fn(extractPagesOk())
    const extractTasksSpy = vi.fn(extractedTasksOk([CANDIDATE]))
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, modelFamily: FAMILY, applianceType: 'dishwasher' }, makeDeps({
      reserveBraveSearch: reserveSpy,
      searchManuals: searchSpy,
      fetchDocument: fetchSpy,
      extractPages: extractPagesSpy,
      extractTasks: extractTasksSpy,
    }))

    // Order matters: reserve -> search -> fetch -> extractPages -> extractTasks.
    expect(reserveSpy.mock.invocationCallOrder[0]).toBeLessThan(searchSpy.mock.invocationCallOrder[0])
    expect(searchSpy.mock.invocationCallOrder[0]).toBeLessThan(fetchSpy.mock.invocationCallOrder[0])
    expect(fetchSpy.mock.invocationCallOrder[0]).toBeLessThan(extractPagesSpy.mock.invocationCallOrder[0])
    expect(extractPagesSpy.mock.invocationCallOrder[0]).toBeLessThan(extractTasksSpy.mock.invocationCallOrder[0])

    expect(result.fallback).toBe('exact')
    expect(result.searchOutcome).toBe('ok')
    expect(result.searchReason).toBe(null)
    expect(result.proposals).toHaveLength(1)
    const proposal = result.proposals[0]
    expect(proposal.evidenceLevel).toBe('manufacturer_verified')
    expect(proposal.source.type).toBe('manufacturer_manual')
    expect(proposal.source.url).toBe(PDF_URL)
    expect(proposal.source.location).toBe('page 1')
    expect(proposal.source.quote).toBe(QUOTE)
    expect(proposal.source.title).toBe('Bosch SMS6ZCI49E user manual')
    expect(proposal.name).toBe('Clean the filter')
  })

  it('names the source from a readable document title, and otherwise from the appliance', async () => {
    const model = 'KEQB7300L'
    const url = 'https://api.electrolux-medialibrary.com/asset/550e8400-e29b-41d4-a716-446655440000/ORIGINAL/550e8400-e29b-41d4-a716-446655440000.pdf'
    const quote = 'Clean the filter every month under running water.'
    const page = `User manual ${model}\n${quote}`
    const proposed = (documentTitle: string) =>
      proposePlan(
        { manufacturer: 'Electrolux', model, applianceType: 'dishwasher' },
        makeDeps({
          manufacturerDomains: { electrolux: ['electrolux.com', 'electrolux-medialibrary.com'] },
          searchManuals: async () => ({
            status: 'ok',
            candidates: [{ url, title: 'Electrolux-medialibrary', snippet: '', host: 'api.electrolux-medialibrary.com' }],
          }),
          fetchDocument: fetchOk(new TextEncoder().encode(page), 'pdf'),
          extractPages: async () => ({ ok: true, pages: [{ page: 1, text: page }], documentTitle }),
          extractTasks: extractedTasksOk([{ ...CANDIDATE, quote, page: 1 }]),
          resolveSource: () => ({ documentModels: [] }),
        }),
      )

    const readable = await proposed('Electrolux KEQB7300L User Manual')
    expect(readable.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    expect(readable.proposals[0].source).toMatchObject({
      title: 'Electrolux KEQB7300L User Manual',
      url,
      location: 'page 1',
      quote,
    })

    const fileName = await proposed('550e8400-e29b-41d4-a716-446655440000.pdf')
    expect(fileName.proposals[0].source.title).toBe('Electrolux KEQB7300L user manual')
    expect(fileName.proposals[0].source.url).toBe(url)
    expect(fileName.proposals[0].source.quote).toBe(quote)
    expect(fileName.proposals[0].evidenceLevel).toBe('manufacturer_verified')
  })

  // Real run, 2026-10-31: the weekly door-gasket quote was attached to "Clean the filters".
  it('drops a task whose verified quote is about something else, keeping the on-task ones', async () => {
    const model = 'KEQB7300L'
    const url = 'https://api.electrolux-medialibrary.com/asset/manual.pdf'
    const task = (name: string, quote: string) => ({ ...CANDIDATE, task: name, quote, page: 1 })
    const tasks = [
      task('Clean the filters', 'wipe clean the door, including the rubber gasket, once a week.'),
      task('Clean the lower spray arm', 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.'),
      task('Check for foreign objects in the filters and sump', 'check the filters and the sump after each use of the dishwasher.'),
    ]
    const page = `User manual ${model}\n${tasks.map((t) => t.quote).join('\n')}`
    const result = await proposePlan(
      { manufacturer: 'Electrolux', model, applianceType: 'dishwasher' },
      makeDeps({
        manufacturerDomains: { electrolux: ['electrolux-medialibrary.com'] },
        searchManuals: searchOkWith(url),
        fetchDocument: fetchOk(new TextEncoder().encode(page), 'pdf'),
        extractPages: extractPagesOk(page),
        extractTasks: extractedTasksOk(tasks),
        resolveSource: () => ({ documentModels: [] }),
      }),
    )

    expect(result.fallback).toBe('exact')
    expect(result.proposals.map((p) => [p.name, p.evidenceLevel])).toEqual([
      ['Clean the lower spray arm', 'manufacturer_verified'],
      ['Check for foreign objects in the filters and sump', 'manufacturer_verified'],
    ])
    expect(result.proposals.map((p) => p.source.quote)).not.toContain(tasks[0].quote)
  })

  it('proposes the quote’s cadence, not the AI interval', async () => {
    const everyThree = 'Run a cleaning cycle every 3 months to keep the interior fresh.'
    const regularly = 'We recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.'
    const page = `${MODEL}\n${everyThree}\n${regularly}`
    const result = await proposePlan(
      { manufacturer: BOSCH, model: MODEL, modelFamily: FAMILY, applianceType: 'dishwasher' },
      makeDeps({
        searchManuals: searchOkWith(PDF_URL, 'Bosch SMS6 manual'),
        fetchDocument: fetchOk(new TextEncoder().encode(page)),
        extractPages: async () => ({ ok: true, pages: [{ page: 1, text: page }] }),
        extractTasks: async () => [
          {
            task: 'Run a cleaning cycle',
            instructions: 'Hottest cycle.',
            interval: { count: 1, unit: 'month' as const },
            page: 1,
            quote: everyThree,
          },
          {
            task: 'Clean the spray arm',
            instructions: 'Clear the holes.',
            interval: { count: 1, unit: 'month' as const },
            page: 1,
            quote: regularly,
          },
        ],
      }),
    )

    expect(result.fallback).toBe('exact')
    const cleaning = result.proposals.find((p) => p.name === 'Run a cleaning cycle')!
    const spray = result.proposals.find((p) => p.name === 'Clean the spray arm')!
    expect(cleaning.evidenceLevel).toBe('manufacturer_verified')
    expect(cleaning.interval).toEqual({ count: 3, unit: 'month' })
    expect(presentInterval({ quote: cleaning.source.quote, stored: cleaning.interval, generalGuidance: false }).text).toBe(
      'Every 3 months · from the manual',
    )
    expect(spray.evidenceLevel).toBe('manufacturer_verified')
    expect(spray.interval).toEqual({ count: 1, unit: 'month' })
    expect(presentInterval({ quote: spray.source.quote, stored: spray.interval, generalGuidance: false }).text).toBe(
      'Every month · Keeply\'s suggestion. The manual says "regularly".',
    )
  })

  // The route's resolver cannot know a document's models from its URL (it returns none), so the
  // orchestration reads the cover pages: a manual whose first pages name the exact model covers it.
  describe('document model coverage from the cover pages', () => {
    const noModelsFromUrl = () => ({ documentModels: [] as string[], documentFamily: undefined })
    const verifiedWith = (pages: { page: number; text: string; title?: string }[]) =>
      proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
        searchManuals: searchOkWith(PDF_URL),
        fetchDocument: fetchOk(new TextEncoder().encode('x')),
        extractPages: async () => ({ ok: true, pages }),
        resolveSource: noModelsFromUrl,
        extractTasks: extractedTasksOk([CANDIDATE]),
      }))

    it('is manufacturer verified when the model is named on the cover page', async () => {
      const result = await verifiedWith([{ page: 1, text: `User Manual ${MODEL}\n${QUOTE}` }])
      expect(result.fallback).toBe('exact')
      expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    })

    it('is not verified when the model only appears deep in the document', async () => {
      const result = await verifiedWith([
        { page: 1, text: `User Manual\n${QUOTE}` },
        { page: 2, text: 'Contents' },
        { page: 3, text: `Compatible with ${MODEL}` },
      ])
      expect(result.fallback).toBe('general')
    })

    it('is not verified when the model is only a prefix of a longer model number', async () => {
      // SMS6ZCI49EX is a different model in the same family, so the task is Similar-model.
      const result = await verifiedWith([{ page: 1, text: `User Manual ${MODEL}X\n${QUOTE}` }])
      expect(result.fallback).toBe('similar')
      expect(result.proposals[0].evidenceLevel).toBe('similar_model')
      expect(result.proposals.every((p) => p.evidenceLevel !== 'manufacturer_verified')).toBe(true)
    })

    // HTML is one extracted page. The cover is the title plus the first 2,000 characters.
    // A model only in a later "related manuals" list is not a cover match. A PDF page is not cut.
    const htmlPastCover = 'lorem ipsum '.repeat(200)

    it('is not verified when an HTML page names the model only after the first 2,000 characters', async () => {
      const text = `${QUOTE} ${htmlPastCover}related manuals ${MODEL}`
      expect(text.indexOf(MODEL)).toBeGreaterThanOrEqual(2000)
      const result = await verifiedWith([{ page: 1, text, title: 'Bosch support' }])
      expect(result.fallback).toBe('general')
      expect(result.proposals.every((p) => p.evidenceLevel !== 'manufacturer_verified')).toBe(true)
      expect(result.proposals.every((p) => p.evidenceLevel !== 'similar_model')).toBe(true)
    })

    it('is manufacturer verified when the HTML title names the model', async () => {
      const text = `${QUOTE} ${htmlPastCover}related manuals ${MODEL}X`
      expect(text.indexOf(MODEL)).toBeGreaterThanOrEqual(2000)
      const result = await verifiedWith([{ page: 1, text, title: `User Manual ${MODEL}` }])
      expect(result.fallback).toBe('exact')
      expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    })

    it('stays manufacturer verified when an HTML page names the model inside the first 2,000 characters', async () => {
      const text = `User Manual ${MODEL}. ${htmlPastCover}${QUOTE}`
      expect(text.indexOf(MODEL)).toBeLessThan(2000)
      expect(text.indexOf(QUOTE)).toBeGreaterThanOrEqual(2000)
      const result = await verifiedWith([{ page: 1, text, title: 'Bosch support' }])
      expect(result.fallback).toBe('exact')
      expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    })

    it('is not verified when an HTML cut would otherwise turn a longer model number into the owner model', async () => {
      const longer = `${MODEL}X`
      const start = 2000 - (longer.length - 1)
      const text = `${QUOTE}${' '.repeat(start - QUOTE.length)}${longer}`
      expect(text[2000]).toBe('X')
      expect(text.slice(0, 2000).endsWith(MODEL)).toBe(true)
      const result = await verifiedWith([{ page: 1, text, title: 'Bosch support' }])
      expect(result.fallback).toBe('general')
      expect(result.proposals.every((p) => p.evidenceLevel !== 'manufacturer_verified')).toBe(true)
    })

    it('stays manufacturer verified when a PDF page names the model past character 2,000', async () => {
      const text = `${htmlPastCover}User Manual ${MODEL}\n${QUOTE}`
      expect(text.indexOf(MODEL)).toBeGreaterThanOrEqual(2000)
      const result = await verifiedWith([{ page: 1, text }])
      expect(result.fallback).toBe('exact')
      expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    })
  })

  describe('similar-model guidance from the cover pages', () => {
    const quote = 'Clean the filter once a month under running water.'
    const smeg = { smeg: ['smeg.com'] }
    const exactUrl = 'https://www.smeg.com/docs/DI6012-1.pdf'
    const thirdPartyUrl = 'https://manualslib.com/smeg/DI6012-1.pdf'

    function fromManual(args: {
      model: string
      url: string
      pages: { page: number; text: string; title?: string }[]
      quote?: string
      page?: number
      modelFamily?: string
      domains?: Record<string, string[]>
      resolveSource?: PlanDeps['resolveSource']
    }) {
      const cited = args.page ?? 5
      return proposePlan(
        { manufacturer: 'Smeg', model: args.model, modelFamily: args.modelFamily, applianceType: 'dishwasher' },
        makeDeps({
          manufacturerDomains: args.domains ?? smeg,
          searchManuals: searchOkWith(args.url, 'Smeg manual'),
          fetchDocument: fetchOk(new TextEncoder().encode('x')),
          extractPages: async () => ({ ok: true, pages: args.pages }),
          resolveSource: args.resolveSource ?? (() => ({ documentModels: [] })),
          extractTasks: extractedTasksOk([{ ...CANDIDATE, quote: args.quote ?? quote, page: cited }]),
        }),
      )
    }

    it('yields similar_model tasks from a related-model manual with a quote on the cited page', async () => {
      const result = await fromManual({
        model: 'DI6012-1',
        url: exactUrl,
        pages: [
          { page: 1, text: 'User manual DI6012-2' },
          { page: 5, text: `Care and cleaning\n${quote}` },
        ],
      })
      expect(result.fallback).toBe('similar')
      expect(result.proposals).toHaveLength(1)
      expect(result.proposals[0].evidenceLevel).toBe('similar_model')
      expect(result.proposals[0].source).toMatchObject({
        type: 'similar_model_manual',
        title: 'Smeg DI6012-2 user manual',
        url: exactUrl,
        location: 'page 5',
        quote,
        coveredModel: 'DI6012-2',
      })
    })

    it('yields no level-2 task when the quote is not on the cited page', async () => {
      const result = await fromManual({
        model: 'DI6012-1',
        url: exactUrl,
        pages: [
          { page: 1, text: 'User manual DI6012-2' },
          { page: 5, text: 'No maintenance schedule is printed on this page.' },
        ],
      })
      expect(result.fallback).toBe('general')
      expect(result.proposals.every((p) => p.evidenceLevel !== 'similar_model')).toBe(true)
      expect(result.proposals.every((p) => p.evidenceLevel !== 'manufacturer_verified')).toBe(true)
    })

    it('still yields manufacturer_verified for an exact-model manual on the manufacturer domain', async () => {
      const result = await fromManual({
        model: 'DI6012-1',
        url: exactUrl,
        pages: [
          { page: 1, text: 'User manual DI6012-1' },
          { page: 5, text: quote },
        ],
      })
      expect(result.fallback).toBe('exact')
      expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
      expect(result.proposals[0].source.type).toBe('manufacturer_manual')
    })

    it('yields similar_model, never verified, for an exact-model copy on a third-party host', async () => {
      const result = await fromManual({
        model: 'DI6012-1',
        url: thirdPartyUrl,
        pages: [
          { page: 1, text: 'User manual DI6012-1' },
          { page: 5, text: quote },
        ],
      })
      expect(result.fallback).toBe('similar')
      expect(result.proposals).toHaveLength(1)
      expect(result.proposals[0].evidenceLevel).toBe('similar_model')
      expect(result.proposals[0].source.coveredModel).toBe('DI6012-1')
      expect(result.proposals[0].source.url).toBe(thirdPartyUrl)
      expect(result.proposals.every((p) => p.evidenceLevel !== 'manufacturer_verified')).toBe(true)
    })

    it('yields similar_model from an HTML manual that names a related model inside the cover window', async () => {
      const filler = 'lorem ipsum '.repeat(200)
      const text = `User manual DI6012-2. ${filler}${quote}`
      expect(text.indexOf('DI6012-2')).toBeLessThan(2000)
      expect(text.indexOf(quote)).toBeGreaterThanOrEqual(2000)
      const result = await fromManual({
        model: 'DI6012-1',
        url: exactUrl,
        page: 1,
        pages: [{ page: 1, text, title: 'Smeg support' }],
      })
      expect(result.fallback).toBe('similar')
      expect(result.proposals[0].evidenceLevel).toBe('similar_model')
      expect(result.proposals[0].source.coveredModel).toBe('DI6012-2')
    })

    it('drops a related model from a different family', async () => {
      const result = await fromManual({
        model: 'KEQB7300L',
        url: 'https://www.electrolux.com/keqc.pdf',
        domains: { electrolux: ['electrolux.com'] },
        pages: [
          { page: 1, text: 'User manual KEQC7200L' },
          { page: 5, text: quote },
        ],
      })
      expect(result.fallback).toBe('general')
      expect(result.proposals.every((p) => p.evidenceLevel === 'general_guidance')).toBe(true)
    })

    it('ignores a client-sent family and a resolver family the cover does not support', async () => {
      const invented = await fromManual({
        model: 'DI6012-1',
        modelFamily: 'KEQC7200',
        url: exactUrl,
        resolveSource: () => ({ documentModels: [], documentFamily: 'KEQC7200' }),
        pages: [
          { page: 1, text: 'User manual KEQC7200L' },
          { page: 5, text: quote },
        ],
      })
      expect(invented.fallback).toBe('general')

      const real = await fromManual({
        model: 'DI6012-1',
        modelFamily: 'NO-SUCH-FAMILY',
        url: exactUrl,
        pages: [
          { page: 1, text: 'User manual DI6012-2' },
          { page: 5, text: quote },
        ],
      })
      expect(real.proposals[0].evidenceLevel).toBe('similar_model')
      expect(real.proposals[0].source.coveredModel).toBe('DI6012-2')
    })

    it('ends on a manufacturer-verified plan even when an earlier manual was only similar', async () => {
      const related = 'https://www.smeg.com/docs/DI6012-2.pdf'
      const exact = exactUrl
      const result = await proposePlan(
        { manufacturer: 'Smeg', model: 'DI6012-1', modelFamily: 'WRONG', applianceType: 'dishwasher' },
        makeDeps({
          manufacturerDomains: smeg,
          searchManuals: async () => ({
            status: 'ok',
            candidates: [
              { url: related, title: 'related', snippet: '', host: 'www.smeg.com' },
              { url: exact, title: 'exact', snippet: '', host: 'www.smeg.com' },
            ],
          }),
          fetchDocument: async (url: string) => ({
            ok: true as const,
            bytes: new TextEncoder().encode(url === exact ? `DI6012-1\n${quote}` : `DI6012-2\n${quote}`),
            type: 'html' as const,
            url,
          }),
          extractPages: async (bytes) => ({ ok: true as const, pages: [{ page: 1, text: new TextDecoder().decode(bytes) }] }),
          resolveSource: () => ({ documentModels: [] }),
          extractTasks: extractedTasksOk([{ ...CANDIDATE, quote, page: 1 }]),
        }),
      )
      expect(result.fallback).toBe('exact')
      expect(result.proposals).toHaveLength(1)
      expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
      expect(result.proposals[0].source.url).toBe(exact)
    })
  })

  it('labels only manufacturer_verified when P3-1 says so; otherwise similar_model', async () => {
    // The URL is on a non-manufacturer domain. classifyEvidence downgrades to similar_model only
    // when the document declares it covers our model and the family matches.
    const unofficialUrl = `https://manualslib.com/${MODEL}.pdf`
    const searchSpy = vi.fn(searchOkWith(unofficialUrl, 'manualslib'))
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, modelFamily: FAMILY, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: searchSpy,
      fetchDocument: fetchOk(new TextEncoder().encode(PAGE_TEXT)),
      extractPages: extractPagesOk(),
      resolveSource: () => ({ documentModels: [MODEL], documentFamily: FAMILY }),
      extractTasks: extractedTasksOk([CANDIDATE]),
    }))
    expect(result.fallback).toBe('similar')
    expect(result.proposals[0].evidenceLevel).toBe('similar_model')
    expect(result.proposals[0].source.type).toBe('similar_model_manual')
    expect(result.proposals[0].source.url).toBe(unofficialUrl)
  })

  it('falls back to general guidance when nothing yielded a verified or similar task', async () => {
    // The page contains no usable quote AND the document doesn't claim to cover our model or
    // family -> classifyEvidence downgrades to general. The orchestration drops general items
    // that came from a manual because generalGuidance() is already the honest fallback. Then it
    // returns the existing general-guidance list.
    const differentText = 'This document does not state any maintenance schedule.'
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, modelFamily: FAMILY, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: searchOkWith(PDF_URL),
      fetchDocument: fetchOk(new TextEncoder().encode(differentText)),
      extractPages: extractPagesOk(differentText),
      resolveSource: () => ({ documentModels: [], documentFamily: undefined }),
      extractTasks: extractedTasksOk([{ ...CANDIDATE, quote: 'A quote that is not in the page text at all.' }]),
    }))
    expect(result.fallback).toBe('general')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
  })

  it('returns general guidance when searchManuals reports no_results', async () => {
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: async () => ({ status: 'empty', candidates: [], reason: 'no_results' }),
    }))
    expect(result.fallback).toBe('general')
    expect(result.searchOutcome).toBe('no_results')
    expect(result.searchReason).toBe('no_results')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
  })

  it('returns general guidance with reason no_key when searchManuals is unavailable (no API key)', async () => {
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: async () => ({ status: 'unavailable' }),
    }))
    expect(result.fallback).toBe('general')
    expect(result.searchReason).toBe('no_key')
  })

  it('checks the durable quota BEFORE searchManuals and skips the fetch once exhausted', async () => {
    // The spy fetch would throw if a Brave call slipped through. The orchestration's only way to
    // get a manual candidate is through searchManuals, so this also asserts the fetch side never
    // ran when the counter is at the cap.
    const fetch = vi.fn(async () => { throw new Error('Brave fetch must not happen at the cap') })
    const search = vi.fn(async () => {
      throw new Error('searchManuals must not happen at the cap')
    })
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      reserveBraveSearch: async () => 'quota_exhausted',
      searchManuals: search as unknown as PlanDeps['searchManuals'],
      fetchDocument: fetch as unknown as PlanDeps['fetchDocument'],
    }))
    expect(result.fallback).toBe('general')
    expect(result.searchOutcome).toBe('quota_exhausted')
    expect(result.searchReason).toBe('quota_exhausted')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
    expect(search).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports typed rate_limited and falls back to general guidance when Brave returns 429', async () => {
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: async () => ({ status: 'empty', candidates: [], reason: 'rate_limited' }),
    }))
    expect(result.fallback).toBe('general')
    expect(result.searchOutcome).toBe('no_results')
    expect(result.searchReason).toBe('rate_limited')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
  })

  it('does not promote general-from-manual: a manual that only yields general is dropped', async () => {
    // The manual extracts candidates but classifyEvidence downgrades all of them to general.
    // The orchestration must NOT emit them as proposals; it must fall back to generalGuidance()
    // (the existing honest list). The chain rule: similar-model -> general, not general from
    // a manual.
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, modelFamily: FAMILY, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: searchOkWith(PDF_URL),
      fetchDocument: fetchOk(new TextEncoder().encode(PAGE_TEXT)),
      extractPages: extractPagesOk(),
      resolveSource: () => ({ documentModels: [], documentFamily: undefined }),
      extractTasks: extractedTasksOk([{ ...CANDIDATE, quote: 'A quote that is not in the page text at all.' }]),
    }))
    expect(result.fallback).toBe('general')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
  })

  it('tries the next candidate when fetchDocument fails on the first', async () => {
    const goodUrl = `https://${BOSCH_DOMAIN}/${MODEL}.pdf`
    const badUrl = `https://${BOSCH_DOMAIN}/broken.pdf`
    const search = vi.fn(async () => ({
      status: 'ok' as const,
      candidates: [
        { url: badUrl, title: 'broken', snippet: '', host: BOSCH_DOMAIN },
        { url: goodUrl, title: 'good', snippet: '', host: BOSCH_DOMAIN },
      ],
    }))
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, modelFamily: FAMILY, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: search,
      fetchDocument: vi.fn(async (url: string) =>
        url === goodUrl
          ? { ok: true as const, bytes: new TextEncoder().encode(PAGE_TEXT), type: 'html' as const, url }
          : { ok: false as const, reason: 'fetch_failed' as const },
      ),
      extractPages: extractPagesOk(),
      resolveSource: () => ({ documentModels: [MODEL], documentFamily: FAMILY }),
      extractTasks: extractedTasksOk([CANDIDATE]),
    }))
    expect(result.fallback).toBe('exact')
    expect(result.proposals[0].source.url).toBe(goodUrl)
  })

  it('tries the next candidate when extractPages fails on the first', async () => {
    const goodUrl = `https://${BOSCH_DOMAIN}/${MODEL}.pdf`
    const badUrl = `https://${BOSCH_DOMAIN}/empty.pdf`
    const search = vi.fn(async () => ({
      status: 'ok' as const,
      candidates: [
        { url: badUrl, title: 'empty', snippet: '', host: BOSCH_DOMAIN },
        { url: goodUrl, title: 'good', snippet: '', host: BOSCH_DOMAIN },
      ],
    }))
    let extractCall = 0
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, modelFamily: FAMILY, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: search,
      fetchDocument: fetchOk(new TextEncoder().encode(PAGE_TEXT)),
      extractPages: vi.fn(async () => {
        extractCall++
        // First call (bad URL) is unreadable; second call (good URL) returns pages.
        return extractCall === 1
          ? { ok: false as const, reason: 'unreadable' as const }
          : { ok: true as const, pages: [{ page: 1, text: PAGE_TEXT }] }
      }),
      resolveSource: () => ({ documentModels: [MODEL], documentFamily: FAMILY }),
      extractTasks: extractedTasksOk([CANDIDATE]),
    }))
    expect(result.fallback).toBe('exact')
    expect(result.proposals[0].source.url).toBe(goodUrl)
  })

  it('falls back to general when extractTasks returns unavailable (Manual AI provider)', async () => {
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: searchOkWith(PDF_URL),
      fetchDocument: fetchOk(new TextEncoder().encode(PAGE_TEXT)),
      extractPages: extractPagesOk(),
      extractTasks: async () => 'unavailable' as const,
    }))
    expect(result.fallback).toBe('general')
    expect(result.searchOutcome).toBe('extraction_unavailable')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
  })

  it('returns general guidance with reason timeout when the route has already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const search = vi.fn(searchOkWith(PDF_URL))
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      signal: controller.signal,
      searchManuals: search,
    }))
    expect(result.fallback).toBe('general')
    expect(result.searchOutcome).toBe('timeout')
    expect(result.searchReason).toBe('timeout')
    expect(search).not.toHaveBeenCalled()
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
  })

  it('keeps a search timeout when Brave times out before any manual is found', async () => {
    const fetch = vi.fn(async () => {
      throw new Error('fetch must not run when search times out')
    })
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: async () => ({ status: 'empty', candidates: [], reason: 'timeout' }),
      fetchDocument: fetch as unknown as PlanDeps['fetchDocument'],
    }))
    expect(result.searchOutcome).toBe('no_results')
    expect(result.searchReason).toBe('timeout')
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports a timeout after manuals were found without a search-step reason', async () => {
    const controller = new AbortController()
    const fetch = vi.fn(async () => ({ ok: false as const, reason: 'fetch_failed' as const }))
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      signal: controller.signal,
      searchManuals: async () => {
        controller.abort()
        return { status: 'ok' as const, candidates: [{ url: PDF_URL, title: 'manual', snippet: '', host: BOSCH_DOMAIN }] }
      },
      fetchDocument: fetch,
    }))
    expect(result.searchOutcome).toBe('timeout')
    expect(result.searchReason).toBe(null)
    expect(fetch).not.toHaveBeenCalled()
    expect(result.proposals).toEqual(GENERAL_DISHWASHER_TASKS)
  })

  it('reports a download timeout as a reading timeout once a manual link exists', async () => {
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      searchManuals: searchOkWith(PDF_URL),
      fetchDocument: async () => ({ ok: false, reason: 'timeout' }),
    }))
    expect(result.searchOutcome).toBe('timeout')
    expect(result.searchReason).toBe(null)
    expect(result.fallback).toBe('general')
  })

  it('uses generalGuidance() verbatim as the no-AI fallback', async () => {
    // Distinctive list — proves the orchestration is not silently rewriting the proposals. Each
    // item is shallow-cloned with `generalSource()` so the UI can render its source, but the task
    // data comes from generalGuidance() exactly.
    const general = [
      {
        name: 'Inspect the door seal',
        instructions: 'Wipe the rubber gasket with a damp cloth and a drop of washing-up liquid.',
        interval: { count: 3, unit: 'month' as const },
        evidenceLevel: 'general_guidance' as const,
        source: {
          type: 'general_guidance' as const,
          title: 'Keeply general dishwasher maintenance guidance',
          url: null,
          location: null,
          quote: null,
        },
      },
    ]
    const result = await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, makeDeps({
      generalGuidance: () => general,
      searchManuals: async () => ({ status: 'empty', candidates: [], reason: 'no_results' }),
    }))
    // The orchestration clones with generalSource() so the caller sees a fresh, honest source.
    expect(result.proposals).toHaveLength(general.length)
    expect(result.proposals[0].name).toBe(general[0].name)
    expect(result.proposals[0].instructions).toBe(general[0].instructions)
    expect(result.proposals[0].evidenceLevel).toBe('general_guidance')
    expect(result.proposals[0].source.type).toBe('general_guidance')
    expect(result.proposals[0].interval).toEqual(general[0].interval)
  })

  it('cold-start durability: a fresh orchestration instance reads the durable counter first', async () => {
    // Simulates a serverless cold start: brand-new deps object, the only durable signal the
    // orchestration has is reserveBraveSearch. It must call it before any other step.
    const order: string[] = []
    const deps = makeDeps({
      reserveBraveSearch: vi.fn(async () => { order.push('reserve'); return 'allowed' as const }),
      searchManuals: vi.fn(async () => { order.push('search'); return { status: 'ok' as const, candidates: [] } }),
      fetchDocument: vi.fn(async () => { order.push('fetch'); return { ok: false as const, reason: 'fetch_failed' as const } }),
      extractPages: vi.fn(async () => { order.push('pages'); return { ok: false as const, reason: 'unreadable' as const } }),
      extractTasks: vi.fn(async () => { order.push('tasks'); return [] }),
    })
    await proposePlan({ manufacturer: BOSCH, model: MODEL, applianceType: 'dishwasher' }, deps)
    expect(order[0]).toBe('reserve')
  })

  // KEE-60: owner decision (KEE-59) — only dishwashers get the hand-curated general-guidance
  // list when no manual is found. Other appliances get an empty plan with a no_plan outcome so
  // the UI can show a plain "no plan could be built" message with the manual-entry path. We
  // never invent dishwasher tasks for another appliance (non-negotiables 2 and 4).
  it('keeps a timeout when a non-dishwasher search is already out of time', async () => {
    const controller = new AbortController()
    controller.abort()
    const search = vi.fn()
    const result = await proposePlan(
      { manufacturer: 'LG', model: 'LRFXS2503S', applianceType: 'fridge' },
      makeDeps({ signal: controller.signal, searchManuals: search }),
    )
    expect(result.proposals).toEqual([])
    expect(result.searchOutcome).toBe('timeout')
    expect(result.searchReason).toBe('timeout')
    expect(search).not.toHaveBeenCalled()
  })

  it('KEE-60: a non-dishwasher with no manual returns an empty plan, not dishwasher general tasks', async () => {
    const generalSpy = vi.fn(() => GENERAL_DISHWASHER_TASKS)
    const result = await proposePlan(
      { manufacturer: 'LG', model: 'LRFXS2503S', applianceType: 'fridge' },
      makeDeps({
        generalGuidance: generalSpy,
        searchManuals: async () => ({ status: 'empty' as const, candidates: [], reason: 'no_results' as const }),
      }),
    )
    expect(result.proposals).toEqual([])
    expect(result.fallback).toBe('general')
    // The UI looks at searchOutcome first; the reason carries the underlying search detail.
    expect(result.searchOutcome).toBe('no_plan')
    expect(result.searchReason).toBe('no_results')
    // Never called the general list for a non-dishwasher; never fabricated dishwasher tasks.
    expect(generalSpy).not.toHaveBeenCalled()
  })

  it('KEE-60: a non-dishwasher with no manual does not consume the search quota needlessly', async () => {
    // The route refuses to save an empty plan (the migration requires at least one task). When no
    // manual is found, the orchestration must return a no_plan outcome so the UI shows the
    // manual-entry path instead of pretending a search happened.
    const reserve = vi.fn(async () => 'allowed' as const)
    const search = vi.fn(async (): ReturnType<PlanDeps['searchManuals']> => ({ status: 'empty', candidates: [], reason: 'no_results' }))
    const result = await proposePlan(
      { manufacturer: 'Miele', model: 'WSD663', applianceType: 'washing machine' },
      makeDeps({ reserveBraveSearch: reserve, searchManuals: search }),
    )
    expect(result.proposals).toEqual([])
    expect(result.searchOutcome).toBe('no_plan')
    // We still consulted the durable counter; the search ran and was empty. We do not retry.
    expect(reserve).toHaveBeenCalledTimes(1)
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('KEE-60: a non-dishwasher with a verified manual still gets the manual\'s tasks', async () => {
    // KEE-60 only changes the fallback behaviour. If a real manufacturer manual was located and
    // classified as verified, those tasks are still used — even for a fridge.
    const fridgeModel = 'LRFXS2503S'
    const fridgeFamily = 'LRFXS25'
    const lgDomain = 'lg.com'
    const lgPdfUrl = `https://${lgDomain}/docs/${fridgeModel}.pdf`
    const result = await proposePlan(
      { manufacturer: 'LG', model: fridgeModel, modelFamily: fridgeFamily, applianceType: 'fridge' },
      makeDeps({
        manufacturerDomains: { lg: [lgDomain] },
        searchManuals: searchOkWith(lgPdfUrl, 'LG fridge manual'),
        fetchDocument: fetchOk(new TextEncoder().encode(PAGE_TEXT)),
        // Cover text names this fridge, which is what lets the manual reach the AI.
        extractPages: extractPagesOk(`User manual ${fridgeModel}\n${PAGE_TEXT}`),
        resolveSource: () => ({ documentModels: [fridgeModel], documentFamily: fridgeFamily }),
        extractTasks: extractedTasksOk([CANDIDATE]),
      }),
    )
    expect(result.fallback).toBe('exact')
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
  })
})

// RF-345: a manual ranked below 3rd is still read. Cover text is checked before any AI call.
describe('proposePlan candidate window', () => {
  const MODEL = 'KEQB7300L'
  const QUOTE = 'Wipe the door gasket with a damp cloth every month.'
  const DOMAINS = { electrolux: ['electrolux.com', 'electrolux-medialibrary.com'] }
  const EXACT_URL = 'https://api.electrolux-medialibrary.com/KEQB7300L.pdf'

  function listed(url: string, title: string) {
    return { url, title, snippet: '', host: new URL(url).host }
  }

  function textOf(bytes: Uint8Array): string {
    return new TextDecoder().decode(bytes)
  }

  function planFor(
    candidates: { url: string; title: string; snippet: string; host: string }[],
    deps: Partial<PlanDeps>,
  ) {
    const search = vi.fn(async () => ({ status: 'ok' as const, candidates }))
    const result = proposePlan(
      { manufacturer: 'Electrolux', model: MODEL, applianceType: 'oven' },
      makeDeps({
        manufacturerDomains: DOMAINS,
        resolveSource: () => ({ documentModels: [] }),
        searchManuals: search,
        ...deps,
      }),
    )
    return { search, result }
  }

  const verifiedTask = {
    task: 'Clean the door gasket',
    instructions: 'Wipe the rubber gasket with a damp cloth.',
    interval: { count: 1, unit: 'month' as const },
    page: 1,
    quote: QUOTE,
  }

  it('returns a manufacturer-verified plan when the exact manual is ranked 5th', async () => {
    const urls = [
      'https://api.electrolux-medialibrary.com/other.pdf',
      'https://api.electrolux-medialibrary.com/broken.pdf',
      'https://manualslib.com/unrelated.pdf',
      'https://example.com/notes.pdf',
      EXACT_URL,
    ]
    let inFlight = 0
    let maxInFlight = 0
    const extractTasks = vi.fn(async ({ pages }: { pages: readonly { page: number; text: string }[] }) => {
      expect(pages.map((p) => p.text).join('\n')).toContain(MODEL)
      return [verifiedTask]
    })
    const { search, result: pending } = planFor(
      urls.map((url, i) => listed(url, `manual ${i + 1}`)),
      {
        fetchDocument: async (url) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await Promise.resolve()
          inFlight -= 1
          if (url.endsWith('broken.pdf')) return { ok: false, reason: 'fetch_failed' }
          const text = url === EXACT_URL ? `User manual ${MODEL}\n${QUOTE}` : 'User manual ZZ9999'
          return { ok: true, bytes: new TextEncoder().encode(text), type: 'pdf', url }
        },
        extractPages: async (bytes) => ({ ok: true, pages: [{ page: 1, text: textOf(bytes) }] }),
        extractTasks,
      },
    )
    const result = await pending
    expect(maxInFlight).toBe(5)
    expect(search).toHaveBeenCalledTimes(1)
    expect(extractTasks).toHaveBeenCalledTimes(1)
    expect(result.fallback).toBe('exact')
    expect(result.searchOutcome).toBe('ok')
    expect(result.proposals).toHaveLength(1)
    expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    expect(result.proposals[0].source.url).toBe(EXACT_URL)
    expect(result.proposals[0].source.location).toBe('page 1')
    expect(result.proposals[0].source.quote).toBe(QUOTE)
  })

  it('sends at most three cover matches to extractTasks, in Brave rank within the group', async () => {
    const urls = [0, 1, 2, 3, 4].map((i) => `https://api.electrolux-medialibrary.com/${i}.pdf`)
    const seen: string[] = []
    const fetchDocument = vi.fn(async (url: string) => {
      const rank = urls.indexOf(url)
      return {
        ok: true as const,
        bytes: new TextEncoder().encode(`rank ${rank} User manual ${MODEL}\n${QUOTE}`),
        type: 'pdf' as const,
        url,
      }
    })
    const { result } = planFor(
      urls.map((url, i) => listed(url, `manual ${i}`)),
      {
        fetchDocument,
        extractPages: async (bytes) => ({ ok: true, pages: [{ page: 1, text: textOf(bytes) }] }),
        extractTasks: async ({ pages }) => {
          seen.push(pages[0].text)
          return []
        },
      },
    )
    await result
    expect(fetchDocument).toHaveBeenCalledTimes(5)
    expect(seen).toEqual([
      `rank 0 User manual ${MODEL}\n${QUOTE}`,
      `rank 1 User manual ${MODEL}\n${QUOTE}`,
      `rank 2 User manual ${MODEL}\n${QUOTE}`,
    ])
  })

  it('keeps going when the 2nd download fails and the 5th cover names the model', async () => {
    const urls = [0, 1, 2, 3, 4].map((i) => `https://api.electrolux-medialibrary.com/${i}.pdf`)
    const extractTasks = vi.fn(async () => [verifiedTask])
    const { result } = planFor(
      urls.map((url, i) => listed(url, `manual ${i}`)),
      {
        fetchDocument: async (url) => {
          if (url === urls[1]) return { ok: false, reason: 'fetch_failed' }
          const text = url === urls[4] ? `User manual ${MODEL}\n${QUOTE}` : 'User manual ZZ9999'
          return { ok: true, bytes: new TextEncoder().encode(text), type: 'pdf', url }
        },
        extractPages: async (bytes) => ({ ok: true, pages: [{ page: 1, text: textOf(bytes) }] }),
        extractTasks,
      },
    )
    const resultValue = await result
    expect(extractTasks).toHaveBeenCalledTimes(1)
    expect(resultValue.proposals[0].evidenceLevel).toBe('manufacturer_verified')
    expect(resultValue.proposals[0].source.url).toBe(urls[4])
  })

  it('skips a download that is still running after 8s and returns inside the plan budget', async () => {
    const urls = [0, 1, 2, 3, 4].map((i) => `https://api.electrolux-medialibrary.com/${i}.pdf`)
    const slow = urls[1]
    const timers: { ms: number; fire: () => void }[] = []
    let releaseSlow = () => {}
    const started = Date.now()
    const { result: pending } = planFor(
      urls.map((url, i) => listed(url, `manual ${i}`)),
      {
        scheduleTimeout: (ms, onFire) => {
          timers.push({ ms, fire: onFire })
          return () => {}
        },
        fetchDocument: (url) => {
          if (url === slow) {
            return new Promise((resolve) => {
              releaseSlow = () => resolve({ ok: false, reason: 'fetch_failed' })
            })
          }
          const text = url === urls[4] ? `User manual ${MODEL}\n${QUOTE}` : 'User manual ZZ9999'
          return Promise.resolve({ ok: true, bytes: new TextEncoder().encode(text), type: 'pdf', url })
        },
        extractPages: async (bytes) => ({ ok: true, pages: [{ page: 1, text: textOf(bytes) }] }),
        extractTasks: async () => [verifiedTask],
      },
    )
    try {
      await vi.waitFor(() => {
        expect(timers.some((timer) => timer.ms === 8_000)).toBe(true)
      })
      for (const timer of timers) {
        if (timer.ms === 8_000) timer.fire()
      }
      const result = await pending
      expect(Date.now() - started).toBeLessThan(8_000)
      expect(result.fallback).toBe('exact')
      expect(result.searchOutcome).toBe('ok')
      expect(result.proposals[0].evidenceLevel).toBe('manufacturer_verified')
      expect(result.proposals[0].source.url).toBe(urls[4])
    } finally {
      releaseSlow()
    }
  })

  it('reads manufacturer-domain exact manuals before third-party exact manuals before family-only ones', async () => {
    const family = 'https://api.electrolux-medialibrary.com/family.pdf'
    const thirdBetter = 'https://manualslib.com/better.pdf'
    const thirdWorse = 'https://manualslib.com/worse.pdf'
    const makerBetter = 'https://api.electrolux-medialibrary.com/better.pdf'
    const makerWorse = 'https://api.electrolux-medialibrary.com/worse.pdf'
    // Brave lists these worst-group first. AI order is the reverse, and the earlier rank wins inside a group.
    const rows = [
      { url: family, text: 'User manual KEQB7300X' },
      { url: thirdBetter, text: `better third User manual ${MODEL}` },
      { url: makerBetter, text: `better maker User manual ${MODEL}` },
      { url: thirdWorse, text: `worse third User manual ${MODEL}` },
      { url: makerWorse, text: `worse maker User manual ${MODEL}` },
    ]
    const seen: string[] = []
    const { result } = planFor(
      rows.map((row) => listed(row.url, row.url)),
      {
        fetchDocument: async (url) => {
          const row = rows.find((item) => item.url === url)
          return { ok: true, bytes: new TextEncoder().encode(row?.text ?? ''), type: 'pdf', url }
        },
        extractPages: async (bytes) => ({ ok: true, pages: [{ page: 1, text: textOf(bytes) }] }),
        extractTasks: async ({ pages }) => {
          seen.push(pages[0].text)
          return []
        },
      },
    )
    await result
    // The cap of three keeps both manufacturer manuals and the better third-party, and drops the rest.
    expect(seen).toEqual([
      `better maker User manual ${MODEL}`,
      `worse maker User manual ${MODEL}`,
      `better third User manual ${MODEL}`,
    ])

    const oneOfEach = [
      { url: family, text: 'family User manual KEQB7300X' },
      { url: thirdBetter, text: `third User manual ${MODEL}` },
      { url: makerBetter, text: `maker User manual ${MODEL}` },
    ]
    const order: string[] = []
    const second = planFor(
      oneOfEach.map((row) => listed(row.url, row.url)),
      {
        fetchDocument: async (url) => {
          const row = oneOfEach.find((item) => item.url === url)
          return { ok: true, bytes: new TextEncoder().encode(row?.text ?? ''), type: 'pdf', url }
        },
        extractPages: async (bytes) => ({ ok: true, pages: [{ page: 1, text: textOf(bytes) }] }),
        extractTasks: async ({ pages }) => {
          order.push(pages[0].text)
          return []
        },
      },
    )
    await second.result
    expect(order).toEqual([
      `maker User manual ${MODEL}`,
      `third User manual ${MODEL}`,
      'family User manual KEQB7300X',
    ])
  })

  it('reports no_results when downloads succeed but no cover names the model', async () => {
    const urls = [0, 1, 2, 3, 4].map((i) => `https://api.electrolux-medialibrary.com/${i}.pdf`)
    const extractTasks = vi.fn(async () => [verifiedTask])
    const { result } = planFor(
      urls.map((url, i) => listed(url, `manual ${i}`)),
      {
        fetchDocument: async (url) => {
          if (url === urls[1]) return { ok: false, reason: 'fetch_failed' }
          return { ok: true, bytes: new TextEncoder().encode('User manual ZZ9999'), type: 'pdf', url }
        },
        extractPages: async () => ({ ok: true, pages: [{ page: 1, text: 'User manual ZZ9999' }] }),
        extractTasks,
      },
    )
    const value = await result
    expect(extractTasks).not.toHaveBeenCalled()
    expect(value.searchOutcome).toBe('no_results')
    expect(value.fallback).toBe('general')
    expect(value.proposals).toEqual([])
  })
})