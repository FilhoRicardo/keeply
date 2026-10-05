import 'server-only'
import { getDocumentProxy } from 'unpdf'
import type { DocType } from './fetch-document'
import { normalizeText } from './normalize'

export interface Page {
  page: number
  text: string
}
export type ExtractResult = { ok: true; pages: Page[] } | { ok: false; reason: 'no_text' | 'unreadable' }

const DROPPED_BLOCKS = ['head', 'script', 'style', 'noscript', 'svg', 'template', 'nav', 'header', 'footer', 'aside', 'form']
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function htmlToText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
  for (const tag of DROPPED_BLOCKS) s = s.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ')
  s = s.replace(/<[^>]*>/g, ' ')
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' '
    }
    return ENTITIES[e.toLowerCase()] ?? ' '
  })
}

async function pdfPages(bytes: Uint8Array): Promise<Page[]> {
  // Text only: pdf.js parses; no scripts, forms or embedded actions are run.
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const pages: Page[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    const text = normalizeText(content.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join(''))
    if (text) pages.push({ page: n, text })
  }
  await pdf.cleanup()
  return pages
}

export async function extractPages(bytes: Uint8Array, type: DocType): Promise<ExtractResult> {
  let pages: Page[]
  try {
    if (type === 'pdf') pages = await pdfPages(bytes)
    else {
      const text = normalizeText(htmlToText(new TextDecoder().decode(bytes)))
      pages = text ? [{ page: 1, text }] : []
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  return pages.length ? { ok: true, pages } : { ok: false, reason: 'no_text' }
}
