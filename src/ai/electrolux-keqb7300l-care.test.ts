import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { presentInterval, quoteWithPageCadence, readCadence } from '@/domain/cadence'
import { classifyEvidence, sourceQuoteSatisfiesDbCheck, verifyQuote } from '@/domain/evidence-check'
import { proposePlan } from '@/app/lib/plan-orchestration'
import type { ExtractedPage } from './extraction'
import { manualPagesPrompt } from './openai-chat'

const fixturePath = fileURLToPath(new URL('../test-fixtures/electrolux-keqb7300l-care-pages.json', import.meta.url))
const carePages = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExtractedPage[]

const MANUAL_URL =
  'https://api.electrolux-medialibrary.com/asset/6a10b8fb-6698-499a-9876-168d3ee3de15/E4RM3Q/38756908-624e-413d-95cf-2e2095e38e44/ORIGINAL/38756908-624e-413d-95cf-2e2095e38e44.pdf'
const MODEL = 'KEQB7300L'
const DOMAINS = { electrolux: ['electrolux.com', 'electrolux-medialibrary.com'] }

/** 31-page manual shape from the live KEQB7300L PDF (maintenance block on pages 21–25). */
function keqb7300lManualPages(): ExtractedPage[] {
  const byPage = new Map(carePages.map((p) => [p.page, p]))
  const pages: ExtractedPage[] = [
    { page: 1, text: `electrolux dishwasher ${MODEL} user manual. model ${MODEL}.` },
    { page: 2, text: 'safety information and installation. do not use extension cords.' },
  ]
  for (let p = 3; p <= 31; p++) {
    pages.push(
      byPage.get(p) ?? {
        page: p,
        text: `page ${p}. general use and programmes. ${MODEL} appears in the header only.`,
      },
    )
  }
  return pages
}

const MACHINE_CARE_QUOTE =
  'to maintain the performance of your appliance, use a cleaning product designed specifically for dishwashers at least once every two months. carefully follow the instructions on the packaging of the product. for optimal cleaning results, start the programme machine care.'

const expectedTasks = [
  {
    task: 'Wipe the door gasket',
    quote: 'wipe clean the door, including the rubber gasket, once a week.',
    page: 22,
    interval: { count: 1, unit: 'week' as const },
  },
  {
    task: 'Run Machine Care with dishwasher cleaner',
    quote: MACHINE_CARE_QUOTE,
    page: 22,
    interval: { count: 2, unit: 'month' as const },
  },
  {
    task: 'Clean the filters',
    quote:
      'dirty filters and clogged spray arms negatively affect the washing results. check these elements regularly and, if necessary, clean them.',
    page: 21,
    interval: { count: 1, unit: 'month' as const },
  },
  {
    task: 'Clean the spray arms',
    quote: 'we recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.',
    page: 23,
    interval: { count: 1, unit: 'month' as const },
  },
] as const

function pageText(page: number): string {
  return keqb7300lManualPages().find((p) => p.page === page)!.text
}

describe('Electrolux KEQB7300L care section (live manual text)', () => {
  it('keeps page 22 in the extraction prompt on a 31-page manual', () => {
    const { prompt, pageNumbers } = manualPagesPrompt(keqb7300lManualPages())
    expect(pageNumbers.has(22)).toBe(true)
    expect(prompt).toMatch(/machine care/i)
    expect(prompt).toMatch(/at least once every two months/i)
  })

  it('stores source quotes within the database length check after cadence widening', () => {
    for (const { quote, page } of expectedTasks) {
      const text = pageText(page)
      const stored = quoteWithPageCadence(quote, text)
      expect(sourceQuoteSatisfiesDbCheck(stored)).toBe(true)
      expect(stored.trim().length).toBeGreaterThan(0)
      expect(verifyQuote(text, stored)).toBe(true)
    }
    const shortMachineCare = 'for optimal cleaning results, start the programme machine care.'
    for (const p of carePages) {
      const stored = quoteWithPageCadence(shortMachineCare, p.text)
      expect(sourceQuoteSatisfiesDbCheck(stored)).toBe(true)
      if (verifyQuote(p.text, stored)) {
        expect(stored.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it.each(expectedTasks)('verifies $task on page $page', ({ task, quote, page }) => {
      expect(verifyQuote(pageText(page), quote)).toBe(true)
      expect(
        classifyEvidence({
          source: { url: MANUAL_URL, page, documentModels: [MODEL] },
          model: { name: MODEL },
          manufacturerDomains: DOMAINS.electrolux,
          task,
          quote,
          documentText: pageText(page),
        }),
      ).toEqual({ level: 'manufacturer_verified', reasons: [] })
  })

  it('reads Machine Care cadence as every 2 months from the manual quote', () => {
    expect(readCadence(MACHINE_CARE_QUOTE)).toEqual({ stated: true, interval: { count: 2, unit: 'month' } })
    expect(
      presentInterval({
        quote: MACHINE_CARE_QUOTE,
        stored: { count: 1, unit: 'month' },
        generalGuidance: false,
      }),
    ).toEqual({ interval: { count: 2, unit: 'month' }, text: 'Every 2 months · from the manual' })
  })

  it('proposes all four maintenance tasks when the model returns them', async () => {
    const pages = keqb7300lManualPages()
    const candidates = expectedTasks.map((t) => ({
      task: t.task,
      instructions: 'From the manual.',
      interval: t.interval,
      page: t.page,
      quote: t.quote,
    }))
    const result = await proposePlan(
      { manufacturer: 'Electrolux', model: MODEL, applianceType: 'dishwasher' },
      {
        reserveBraveSearch: async () => 'allowed',
        searchManuals: async () => ({
          status: 'ok',
          candidates: [{ url: MANUAL_URL, title: 'Electrolux manual', snippet: '', host: 'api.electrolux-medialibrary.com' }],
          braveStatus: [200],
        }),
        fetchDocument: async () => ({ ok: true, bytes: new Uint8Array(), type: 'pdf', url: MANUAL_URL }),
        extractPages: async () => ({ ok: true, pages, documentTitle: `Electrolux ${MODEL} user manual` }),
        extractTasks: async () => candidates,
        resolveSource: () => ({ documentModels: [MODEL] }),
        manufacturerDomains: DOMAINS,
        generalGuidance: () => [],
        aiModel: 'google/gemini-2.5-flash-lite',
        signal: AbortSignal.timeout(60_000),
      },
    )

    expect(result.fallback).toBe('exact')
    expect(result.proposals).toHaveLength(4)
    expect(result.proposals.map((p) => p.name).sort()).toEqual(expectedTasks.map((t) => t.task).sort())
    for (const proposal of result.proposals) {
      expect(sourceQuoteSatisfiesDbCheck(proposal.source.quote)).toBe(true)
      expect(proposal.source.quote?.trim().length).toBeGreaterThan(0)
    }
    const machineCare = result.proposals.find((p) => p.name === 'Run Machine Care with dishwasher cleaner')!
    expect(machineCare.evidenceLevel).toBe('manufacturer_verified')
    expect(machineCare.interval).toEqual({ count: 2, unit: 'month' })
    expect(machineCare.source.quote).toBe(MACHINE_CARE_QUOTE)
  })
})
