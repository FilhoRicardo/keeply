import { describe, expect, it } from 'vitest'
import { extractPages } from './extract-pages'
import { verifyQuote } from '@/domain/evidence-check'

// Manual page text and quote, both passed through the single shared normaliser used by
// `extractPages` (storage form) and `verifyQuote` (match form). These cases prove that the
// same normalisation is used for both the page text (extracted from PDF/HTML) and the quote
// string, which is the cross-branch acceptance criterion for Wave 1.

const BASE_PAGE = `Care and cleaning
Remove the dish­
washer filter every month under running water.
Use a well-known descaler to keep the interior clean.`

const PDF_TEXT = 'Clean the filter once a month under running water.'
const PDF_QUOTE = 'Clean the filter once a month under running water.'

describe('extracted page text + verifyQuote share one normaliser', () => {
  const basePromise = extractPages(new TextEncoder().encode(BASE_PAGE), 'html')

  it('matches the exact quote (HTML extraction)', async () => {
    const base = await basePromise
    expect(base.ok).toBe(true)
    if (!base.ok) return
    // The page contains "Remove the dishwasher filter every month under running water."
    expect(verifyQuote(base.pages[0].text, 'Remove the dishwasher filter every month under running water.')).toBe(true)
  })

  it('matches a soft-hyphen line-break hyphenation (real PDF form)', async () => {
    const base = await basePromise
    expect(base.ok).toBe(true)
    if (!base.ok) return
    expect(verifyQuote(base.pages[0].text, 'Remove the dishwasher filter every month under running water.')).toBe(true)
  })

  it('matches a kept line-break hyphenation (genuine compounds)', async () => {
    const base = await basePromise
    expect(base.ok).toBe(true)
    if (!base.ok) return
    expect(verifyQuote(base.pages[0].text, 'Use a well-known descaler to keep the interior clean.')).toBe(true)
  })

  it('rejects a near-miss that a fuzzy matcher could accept', async () => {
    const base = await basePromise
    expect(base.ok).toBe(true)
    if (!base.ok) return
    expect(verifyQuote(base.pages[0].text, 'Clean the filter once a week under running water.')).toBe(false)
  })

  it('rejects a quote shorter than MIN_QUOTE_LENGTH even if it would match', async () => {
    const base = await basePromise
    expect(base.ok).toBe(true)
    if (!base.ok) return
    // "under water." is 12 chars; it appears in the page text but must not verify anything.
    expect(verifyQuote(base.pages[0].text, 'under water.')).toBe(false)
  })

  it('PDF-extracted page text also matches (full pipeline)', async () => {
    const makePdf = (pages: string[]) => {
      const objs: string[] = []
      objs.push('<< /Type /Catalog /Pages 2 0 R >>')
      objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`)
      objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
      pages.forEach((text, i) => {
        const stream = `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`
        objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`)
        objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
      })
      let out = '%PDF-1.4\n'
      const offsets: number[] = []
      objs.forEach((o, i) => {
        offsets.push(out.length)
        out += `${i + 1} 0 obj\n${o}\nendobj\n`
      })
      const xref = out.length
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
      out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
      return new TextEncoder().encode(out)
    }
    const pdf = await extractPages(makePdf([PDF_TEXT]), 'pdf')
    expect(pdf.ok).toBe(true)
    if (!pdf.ok) return
    expect(verifyQuote(pdf.pages[0].text, PDF_QUOTE)).toBe(true)
  })
})