// Display name for a task's source. Evidence level, URL, page and quote stay as classified.
// A saved task keeps whatever title it already stored; this runs only when a plan is proposed.

const UUID = /^(?:\{)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\})?$/i

function clean(raw: string): string {
  return raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
}

function isPdfFileName(title: string): boolean {
  const leaf = title.split(/[/\\?#]/).pop() ?? title
  return /\.pdf$/i.test(leaf.trim())
}

// A host label is the site name Brave (or a PDF) sometimes uses instead of a document name:
// "Electrolux-medialibrary", "api.electrolux-medialibrary.com", "cdn", "api".
function isHostLabel(title: string): boolean {
  if (/\s/.test(title)) return false
  const lower = title.toLowerCase().replace(/\.+$/, '')
  if (lower.includes('medialibrary')) return true
  const labels = lower.split(/[.-]/).filter(Boolean)
  return labels.some((label) => label === 'api' || label === 'cdn')
}

// Authoring tools often leave a placeholder or an export name in the PDF metadata. Live example:
// the Electrolux KEQB7300L manual's metadata title is literally "Title".
function isPlaceholder(title: string): boolean {
  if (!/\s/.test(title)) return true // one word ("Title", "Manual", "KEQB7300L") names nothing
  if (/^microsoft (word|powerpoint|excel)\b/i.test(title)) return true
  return /^(untitled|title|document|manual|user manual|instruction manual)\b/i.test(title) && title.split(/\s+/).length <= 2
}

function readableDocumentTitle(raw: string | null | undefined): string | null {
  if (!raw) return null
  const title = clean(raw)
  if (!title) return null
  if (isPdfFileName(title) || UUID.test(title.replace(/\.pdf$/i, '')) || isHostLabel(title) || isPlaceholder(title)) return null
  return title
}

function applianceManualName(manufacturer: string, model: string): string {
  const who = [manufacturer, model].map((part) => part.trim()).filter(Boolean).join(' ')
  return who ? `${who} user manual` : 'User manual'
}

// Prefer the document's own title when a person would recognise it. Otherwise name the manual
// from the appliance: the confirmed model, or the covered model for Similar-model guidance.
export function manualSourceTitle(input: {
  documentTitle?: string | null
  manufacturer: string
  model: string
}): string {
  return readableDocumentTitle(input.documentTitle) ?? applianceManualName(input.manufacturer, input.model)
}
