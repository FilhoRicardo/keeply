import { describe, expect, it } from 'vitest'
import { proposePlan, type PlanDeps } from '@/app/lib/plan-orchestration'
import { isBlockedAddress } from '@/search/ip'
import { extractPages } from '@/search/extract-pages'
import { buildDefaultManufacturerDomains } from '@/search/rank'
import { verifyQuote } from '@/domain/evidence-check'
import { EXACT_MODEL, extractionReply, FIXTURE_MANUAL_IP, MANUAL_TITLE, MANUAL_URL, manualHtml, OTHER_MODEL, visionReply } from './fixtures'

// The fixture manual, read by the real page extractor and classified by the real plan
// orchestration. The model's interval is yearly on purpose: the quote's cadence is what
// the plan keeps. A cover for EXACT_MODEL is manufacturer verified; the same document
// for OTHER_MODEL (same family, different model) is not.

function deps(model: string): PlanDeps {
  const html = new TextEncoder().encode(manualHtml())
  const tasks = extractionReply().candidates
  return {
    reserveBraveSearch: async () => 'allowed',
    searchManuals: async () => ({
      status: 'ok',
      candidates: [{ url: MANUAL_URL, title: MANUAL_TITLE, snippet: '', host: 'www.bosch-home.com' }],
    }),
    fetchDocument: async (url) => ({ ok: true, bytes: html, type: 'html', url }),
    extractPages: (bytes, type) => extractPages(bytes, type),
    extractTasks: async () =>
      tasks.map((task) => ({
        task: task.task,
        instructions: task.instructions,
        interval: { count: task.interval.count, unit: task.interval.unit as 'year' },
        page: task.page,
        quote: task.quote,
      })),
    resolveSource: () => ({ documentModels: [] }),
    manufacturerDomains: buildDefaultManufacturerDomains(),
    generalGuidance: () => [],
    candidateTitle: (url) => url,
    aiModel: model,
    signal: new AbortController().signal,
  }
}

describe('journey fixtures', () => {
  it('keeps the manual quotes inside the HTML and names the exact model on the cover', async () => {
    const extracted = await extractPages(new TextEncoder().encode(manualHtml()), 'html')
    expect(extracted.ok).toBe(true)
    if (!extracted.ok) return
    const text = extracted.pages.map((page) => page.text).join('\n')
    for (const candidate of extractionReply().candidates) {
      expect(verifyQuote(text, candidate.quote)).toBe(true)
    }
    expect(extracted.pages[0]?.title).toContain(EXACT_MODEL.toLowerCase())
    expect(visionReply().model).toBe(EXACT_MODEL)
    expect(isBlockedAddress(FIXTURE_MANUAL_IP)).toBe(false)
  })

  it('verifies tasks when the manual covers the exact model', async () => {
    const result = await proposePlan({ manufacturer: 'Bosch', model: EXACT_MODEL, applianceType: 'dishwasher' }, deps(EXACT_MODEL))
    expect(result.fallback).toBe('exact')
    expect(result.searchOutcome).toBe('ok')
    expect(result.proposals.map((task) => [task.name, task.evidenceLevel, task.interval])).toEqual([
      ['Clean the filter', 'manufacturer_verified', { count: 1, unit: 'month' }],
      ['Check the spray arms', 'manufacturer_verified', { count: 3, unit: 'month' }],
    ])
    expect(result.proposals[0]?.source.location).toBe('page 1')
    expect(result.proposals[0]?.source.quote).toBe(extractionReply().candidates[0]?.quote)
  })

  it('does not verify a manual for a different model', async () => {
    const result = await proposePlan({ manufacturer: 'Bosch', model: OTHER_MODEL, applianceType: 'dishwasher' }, deps(OTHER_MODEL))
    expect(result.fallback).toBe('similar')
    expect(result.proposals.length).toBeGreaterThan(0)
    expect(result.proposals.every((task) => task.evidenceLevel === 'similar_model')).toBe(true)
    expect(result.proposals.every((task) => task.evidenceLevel !== 'manufacturer_verified')).toBe(true)
    expect(result.proposals[0]?.source.coveredModel).toBe(EXACT_MODEL)
  })
})
