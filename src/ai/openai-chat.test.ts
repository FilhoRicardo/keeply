import { describe, expect, it } from 'vitest'
import type { ExtractedPage } from './extraction'
import { chunkPagesForExtraction, manualPagesPrompt } from './openai-chat'

function fillerPage(page: number): ExtractedPage {
  return {
    page,
    text: `Page ${page}. Safety warnings and installation. Do not use extension cords. KEQB7300L appears on the cover only.`,
  }
}

/** Realistic dishwasher manual: long front matter, maintenance in a late "Care and cleaning" block. */
function electroluxStyleManual(): ExtractedPage[] {
  const pages: ExtractedPage[] = []
  for (let p = 1; p <= 28; p++) pages.push(fillerPage(p))
  pages[0] = { page: 1, text: 'Electrolux dishwasher KEQB7300L user manual. Model KEQB7300L.' }
  const care = [
    {
      page: 29,
      text:
        'Care and cleaning. Wipe the door gasket weekly with a damp cloth to remove food residue. ' +
        'Clean the coarse filter after every wash cycle when visible soil remains.',
    },
    {
      page: 30,
      text:
        'Remove and rinse the fine filter under running water every month. Check spray arms every six months; ' +
        'clear blocked holes with a toothpick.',
    },
    {
      page: 31,
      text:
        'Run a descaling programme every three months using dishwasher cleaner. Refill salt when the indicator lights. ' +
        'Keep the rinse aid dispenser topped up.',
    },
    {
      page: 32,
      text: 'Troubleshooting. If dishes are wet, open the door slightly after the cycle ends.',
    },
  ]
  pages.push(...care)
  for (let p = 33; p <= 45; p++) pages.push(fillerPage(p))
  return pages
}

describe('manualPagesPrompt', () => {
  it('includes late care-and-cleaning pages instead of truncating at the manual front matter', () => {
    const { prompt, pageNumbers } = manualPagesPrompt(electroluxStyleManual())
    expect(pageNumbers.has(29)).toBe(true)
    expect(pageNumbers.has(30)).toBe(true)
    expect(pageNumbers.has(31)).toBe(true)
    expect(prompt).toMatch(/Care and cleaning/i)
    expect(prompt).toMatch(/door gasket/i)
    expect(prompt).toMatch(/spray arms/i)
    expect(prompt).toMatch(/descaling/i)
    expect(prompt).toMatch(/rinse aid/i)
    // Front-matter filler should not crowd out the maintenance block on a long manual.
    expect(pageNumbers.has(15)).toBe(false)
  })

  it('keeps cover pages for model context on a long manual', () => {
    const { pageNumbers } = manualPagesPrompt(electroluxStyleManual())
    expect(pageNumbers.has(1)).toBe(true)
  })

  it('splits long manuals into parallel extraction chunks of maintenance pages', () => {
    const pages = electroluxStyleManual()
    const chunks = chunkPagesForExtraction(pages, 2)
    expect(chunks.length).toBeGreaterThan(1)
    const pageNums = chunks.flatMap((c) => c.map((p) => p.page))
    expect(pageNums).toContain(29)
    expect(pageNums).toContain(31)
    expect(chunks[0]?.some((p) => p.page === 1)).toBe(true)
  })

  it('passes through short manuals unchanged apart from ordering', () => {
    const short: ExtractedPage[] = [
      { page: 1, text: 'KEQB7300L manual cover.' },
      { page: 2, text: 'Care and cleaning. Wipe the door gasket weekly.' },
    ]
    const { prompt, pageNumbers } = manualPagesPrompt(short)
    expect(pageNumbers).toEqual(new Set([1, 2]))
    expect(prompt).toContain('[Page 1]')
    expect(prompt).toContain('[Page 2]')
  })
})
