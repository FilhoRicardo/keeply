import { describe, expect, it } from 'vitest'
import { extractPages } from './extract-pages'

// Minimal valid PDF; a page with text === null is image-only (no text operators).
function makePdf(pages: (string | null)[]): Uint8Array {
  const objs: string[] = []
  const n = pages.length
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(' ')}] /Count ${n} >>`)
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  pages.forEach((text, i) => {
    const stream = text === null ? 'q 10 0 0 10 0 0 cm Q' : `BT /F1 12 Tf 72 700 Td (${text}) Tj ET`
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

describe('extractPages', () => {
  it('returns one entry per PDF page with correct page numbers, normalised', async () => {
    const r = await extractPages(makePdf(['Cover Page', 'Clean the FILTER monthly', 'Descale every 6 months']), 'pdf')
    expect(r).toEqual({
      ok: true,
      pages: [
        { page: 1, text: 'cover page' },
        { page: 2, text: 'clean the filter monthly' },
        { page: 3, text: 'descale every 6 months' },
      ],
    })
  })

  it('keeps page numbers when an interior page has no text', async () => {
    const r = await extractPages(makePdf(['first', null, 'third']), 'pdf')
    expect(r).toMatchObject({ ok: true })
    if (r.ok) expect(r.pages.map((p) => p.page)).toEqual([1, 3])
  })

  it('reports no_text for an image-only (scanned) PDF', async () => {
    expect(await extractPages(makePdf([null, null]), 'pdf')).toEqual({ ok: false, reason: 'no_text' })
  })

  it('reports unreadable for bytes that are not a PDF', async () => {
    expect(await extractPages(new TextEncoder().encode('nope'), 'pdf')).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('extracts html as a single page, dropping scripts, styles and boilerplate, decoding entities', async () => {
    const html = `<html><head><title>x</title><style>.a{}</style><script>alert(1)</script></head>
      <body><nav>Menu Home</nav><main><h1>Dishwasher Care</h1><p>Clean the filter &amp; spray arms.</p></main>
      <footer>Copyright</footer></body></html>`
    const r = await extractPages(new TextEncoder().encode(html), 'html')
    expect(r).toEqual({
      ok: true,
      pages: [{ page: 1, text: 'dishwasher care clean the filter & spray arms.', title: 'x' }],
    })
  })

  it('keeps an empty title when the html document has none, so the cover window still applies', async () => {
    const html = '<html><body><p>Clean the filter monthly.</p></body></html>'
    const r = await extractPages(new TextEncoder().encode(html), 'html')
    expect(r).toEqual({ ok: true, pages: [{ page: 1, text: 'clean the filter monthly.', title: '' }] })
  })

  it('reports no_text for html with no body text', async () => {
    expect(await extractPages(new TextEncoder().encode('<html><script>x()</script></html>'), 'html')).toEqual({ ok: false, reason: 'no_text' })
  })
})
