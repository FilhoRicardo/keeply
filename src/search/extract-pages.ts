import 'server-only'
import { getDocumentProxy, getMeta } from 'unpdf'
import { normalizeText } from '@/domain/normalize'
import type { DocType } from './fetch-document'

export interface Page {
  page: number
  text: string
  // HTML only, including "" when the document has no <title>. Cover matching treats a page
  // with this field as HTML: the title plus the first 2,000 characters, not the whole page.
  // This copy is normalised (lowercase). The display name is `documentTitle` on the result.
  title?: string
}
export type ExtractResult =
  | { ok: true; pages: Page[]; documentTitle?: string | null }
  | { ok: false; reason: 'no_text' | 'unreadable' }

const DROPPED_BLOCKS = ['head', 'script', 'style', 'noscript', 'svg', 'template', 'nav', 'header', 'footer', 'aside', 'form']
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

function htmlTitleRaw(html: string): string {
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, ' ')
  const match = withoutComments.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)
  if (!match) return ''
  return htmlToText(match[1]).replace(/\s+/g, ' ').trim()
}

function htmlTitle(html: string): string {
  const raw = htmlTitleRaw(html)
  return raw ? normalizeText(raw) : ''
}

function htmlDocumentTitle(html: string): string | null {
  return htmlTitleRaw(html) || null
}

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

async function pdfDocumentTitle(pdf: Awaited<ReturnType<typeof getDocumentProxy>>): Promise<string | null> {
  try {
    const { info, metadata } = await getMeta(pdf)
    const fromInfo = typeof info.Title === 'string' ? info.Title : ''
    const fromXmp = metadata && typeof metadata.get === 'function' ? metadata.get('dc:title') : ''
    const raw = fromInfo.trim() ? fromInfo : typeof fromXmp === 'string' ? fromXmp : ''
    const title = raw.replace(/\0/g, '').replace(/\s+/g, ' ').trim()
    return title || null
  } catch {
    return null
  }
}

async function pdfPages(bytes: Uint8Array): Promise<{ pages: Page[]; documentTitle: string | null }> {
  // Text only: pdf.js parses; no scripts, forms or embedded actions are run.
  const pdf = await getDocumentProxy(new Uint8Array(bytes))
  const documentTitle = await pdfDocumentTitle(pdf)
  const pages: Page[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    const text = normalizeText(content.items.map((i) => ('str' in i ? i.str + (i.hasEOL ? '\n' : ' ') : '')).join(''))
    if (text) pages.push({ page: n, text })
  }
  await pdf.cleanup()
  return { pages, documentTitle }
}

export async function extractPages(bytes: Uint8Array, type: DocType): Promise<ExtractResult> {
  let pages: Page[]
  let documentTitle: string | null = null
  try {
    if (type === 'pdf') {
      const pdf = await pdfPages(bytes)
      pages = pdf.pages
      documentTitle = pdf.documentTitle
    } else {
      const raw = new TextDecoder().decode(bytes)
      const text = normalizeText(htmlToText(raw))
      pages = text ? [{ page: 1, text, title: htmlTitle(raw) }] : []
      documentTitle = pages.length ? htmlDocumentTitle(raw) : null
    }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
  return pages.length ? { ok: true, pages, documentTitle } : { ok: false, reason: 'no_text' }
}
