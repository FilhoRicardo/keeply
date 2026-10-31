// Keeply's provider-neutral appliance identity. Every AI adapter returns exactly this shape;
// provider request/response formats never leave their adapter. KEE-60: any household appliance,
// not only dishwashers. `applianceType` is a category quoted from the label, one Keeply derives
// from parts the model lists as visible, or "unknown". RF-350: a category the model names
// without that support is "unknown". A free model was answering "oven" for dishwasher labels
// that never print the type. The owner still confirms.
export type ApplianceIdentity = {
  applianceType: string
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  // 0..1, the provider's own estimate. A proposal only: the owner confirms or corrects.
  confidence: number
}

export type LabelPhoto = { bytes: Uint8Array; mimeType: string }

// What adapters ask the model for. Kept here so every provider asks the same question.
// KEE-60: the prompt no longer assumes a dishwasher. RF-350: the category has to be printed
// on the label. A list of example categories was being copied back as a guess, so the
// visibleParts rule names no part either. Letting the model choose a category from the picture
// produced "oven" for both dishwasher plates (2026-10-31): the model only lists what it sees.
export const IDENTITY_INSTRUCTIONS = `You read the rating label of a household appliance from a photo.
Reply with only one JSON object, no other text:
{"applianceType": string, "typeEvidence": string | null, "visibleParts": string[], "manufacturer": string | null, "model": string | null, "serialNumber": string | null, "confidence": number}
Rules:
- applianceType is a short English category, or "unknown".
- Set a category only from printed type text or a product-category word printed on the label. Copy those exact printed words into typeEvidence.
- A model-number prefix counts only when you are certain that prefix always means exactly one category. If you are not certain, do not use the prefix. When you use a prefix, copy the printed model number into typeEvidence.
- If the label does not print the category, applianceType is "unknown" and typeEvidence is null.
- Do not guess a category from the picture, the brand, or the shape of the appliance. An unrecognised appliance is "unknown".
- visibleParts lists the parts of the appliance itself that you can plainly see outside the label, each in a few plain words. Do not name the appliance or its category there. Use [] when none are clearly visible.
- Copy manufacturer, model and serialNumber exactly as printed. Use null when a field is not clearly legible. Never guess a model or serial number.
- confidence is 0 to 1 for how sure you are of manufacturer and model together.`

const text = (value: unknown, max = 80): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\s+/g, ' ')
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null
}

// Finds the first parseable JSON object in a model reply (models sometimes wrap it in prose or
// ```json, or mention braces before the object itself).
export function extractJsonObject(reply: string): unknown {
  for (let start = reply.indexOf('{'); start >= 0; start = reply.indexOf('{', start + 1)) {
    const parsed = balancedObjectAt(reply, start)
    if (parsed !== undefined) return parsed
  }
  return null
}

// Outermost JSON objects and arrays, in order. A value nested inside another is not listed
// again, so a wrapper and the object it contains stay distinguishable.
export function extractJsonValues(reply: string): unknown[] {
  const found: unknown[] = []
  for (let i = 0; i < reply.length; i++) {
    const ch = reply[i]
    if (ch !== '{' && ch !== '[') continue
    const parsed = balancedJsonAt(reply, i)
    if (!parsed) continue
    found.push(parsed.value)
    i = parsed.end - 1
  }
  return found
}

function balancedObjectAt(reply: string, start: number): unknown {
  if (reply[start] !== '{') return undefined
  return balancedJsonAt(reply, start)?.value
}

// Parses the balanced {...} or [...] span starting at `start`. Undefined when it is unbalanced
// or not JSON. Arrays count toward depth so a `}` inside an array is not treated as the end.
function balancedJsonAt(reply: string, start: number): { value: unknown; end: number } | undefined {
  const opener = reply[start]
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : ''
  if (!closer) return undefined
  let depth = 0
  let inString = false
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{' || ch === '[') depth++
    else if (ch === '}' || ch === ']') {
      if (--depth !== 0) continue
      if (ch !== closer) return undefined
      try {
        return { value: JSON.parse(reply.slice(start, i + 1)), end: i + 1 }
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

// Printed category words, including the usual words on a European rating plate.
// Longer phrases are matched first so "microwave oven" is not read as an oven.
const CATEGORY_PHRASES: readonly { canonical: string; phrase: string }[] = (
  [
    ['microwave', 'microwave oven'],
    ['microwave', 'microwave'],
    ['microwave', 'mikrowelle'],
    ['microwave', 'micro-ondes'],
    ['fridge freezer', 'fridge freezer'],
    ['dishwasher', 'dishwasher'],
    ['dishwasher', 'dish washer'],
    ['dishwasher', 'lavastoviglie'],
    ['dishwasher', 'geschirrspüler'],
    ['dishwasher', 'lave-vaisselle'],
    ['dishwasher', 'lavavajillas'],
    ['dishwasher', 'vaatwasser'],
    ['dishwasher', 'diskmaskin'],
    ['washing machine', 'washing machine'],
    ['washing machine', 'lavatrice'],
    ['washing machine', 'waschmaschine'],
    ['washing machine', 'lave-linge'],
    ['washing machine', 'lavadora'],
    ['washing machine', 'wasmachine'],
    ['tumble dryer', 'tumble dryer'],
    ['dryer', 'dryer'],
    ['dryer', 'trockner'],
    ['dryer', 'asciugatrice'],
    ['fridge', 'refrigerator'],
    ['fridge', 'fridge'],
    ['fridge', 'frigorifero'],
    ['fridge', 'kühlschrank'],
    ['fridge', 'réfrigérateur'],
    ['fridge', 'koelkast'],
    ['freezer', 'freezer'],
    ['freezer', 'congelatore'],
    ['oven', 'oven'],
    ['oven', 'backofen'],
    ['oven', 'forno'],
    ['oven', 'horno'],
    ['hob', 'hob'],
    ['hob', 'kochfeld'],
  ] as const
)
  .map(([canonical, phrase]) => ({ canonical: fold(canonical), phrase: fold(phrase) }))
  .sort((a, b) => b.phrase.length - a.phrase.length)

// A one-word claim such as "machine" or "product" is not a category.
const GENERIC_CATEGORIES = new Set(['appliance', 'product', 'machine', 'unit', 'device', 'other', 'unknown', 'home', 'household', 'type', 'model'])

// No prefix is certain enough to name a category by itself. A prefix belongs here only when
// every model that starts with it is that one category. The photos from RF-350 are not entries.
const CERTAIN_MODEL_PREFIXES: readonly { prefix: string; category: string }[] = []
const MIN_CERTAIN_PREFIX = 3

// Parts that belong to one kind of appliance, and the claims each one supports (the first is
// Keeply's name for it). A part several kinds share ("rack", "drum", "shelf", "door") is not
// listed: it says nothing about which appliance this is.
const VISIBLE_PARTS: readonly { parts: readonly string[]; claims: readonly string[] }[] = [
  {
    parts: ['dish rack', 'dish racks', 'dish basket', 'dish baskets', 'plate rack', 'plate racks', 'cutlery basket', 'cutlery baskets', 'cutlery tray', 'cutlery rack', 'spray arm', 'spray arms', 'rinse aid'],
    claims: ['dishwasher'],
  },
  { parts: ['detergent drawer'], claims: ['washing machine'] },
  { parts: ['lint filter', 'fluff filter'], claims: ['dryer', 'tumble dryer'] },
  { parts: ['crisper drawer', 'salad crisper'], claims: ['fridge', 'fridge freezer'] },
  { parts: ['turntable'], claims: ['microwave'] },
].map((entry) => ({ parts: entry.parts.map(fold), claims: entry.claims.map(fold) }))

function fold(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[-_/]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isWordChar(char: string): boolean {
  return char !== '' && /[\p{L}\p{N}]/u.test(char)
}

function findSpans(haystack: string, phrase: string): { start: number; end: number }[] {
  if (phrase.length === 0) return []
  const spans: { start: number; end: number }[] = []
  let from = 0
  while (from <= haystack.length - phrase.length) {
    const at = haystack.indexOf(phrase, from)
    if (at < 0) break
    const before = at > 0 ? haystack[at - 1] : ''
    const after = at + phrase.length < haystack.length ? haystack[at + phrase.length] : ''
    if (!isWordChar(before) && !isWordChar(after)) spans.push({ start: at, end: at + phrase.length })
    from = at + 1
  }
  return spans
}

// Categories whose words actually appear in the quote. The claimed type counts only when
// those same words are in the quote, so a bare "oven" with no quote does not survive.
function printedCategories(evidence: string, claimed: string): string[] {
  const quoted = fold(evidence)
  if (!quoted) return []
  const spans: { start: number; end: number; canonical: string }[] = []
  for (const entry of CATEGORY_PHRASES) {
    for (const span of findSpans(quoted, entry.phrase)) spans.push({ ...span, canonical: entry.canonical })
  }
  const claim = fold(claimed)
  if (claim.length >= 3 && !GENERIC_CATEGORIES.has(claim)) {
    const known = CATEGORY_PHRASES.find((entry) => entry.phrase === claim)
    for (const span of findSpans(quoted, claim)) spans.push({ ...span, canonical: known?.canonical ?? claim })
  }
  const kept = spans.filter(
    (span) =>
      !spans.some(
        (other) =>
          other.end - other.start > span.end - span.start && other.start <= span.start && other.end >= span.end,
      ),
  )
  return [...new Set(kept.map((span) => span.canonical))].filter((category) => !GENERIC_CATEGORIES.has(category))
}

function categoryFromModelPrefix(
  model: string | null,
  evidence: string,
  prefixes: readonly { prefix: string; category: string }[],
): string | null {
  const token = fold(model ?? '')
  const quoted = fold(evidence)
  if (token.length < MIN_CERTAIN_PREFIX || !quoted.includes(token)) return null
  const ordered = [...prefixes].sort((a, b) => fold(b.prefix).length - fold(a.prefix).length)
  for (const item of ordered) {
    const prefix = fold(item.prefix)
    const category = fold(item.category)
    if (prefix.length < MIN_CERTAIN_PREFIX || category === '' || GENERIC_CATEGORIES.has(category)) continue
    if (token.startsWith(prefix)) return category
  }
  return null
}

function canonicalCategory(claimed: string): string {
  const claim = fold(claimed)
  return CATEGORY_PHRASES.find((entry) => entry.phrase === claim)?.canonical ?? claim
}

// Keeply's category for the listed parts, or null. Parts from two kinds of appliance contradict
// each other. A claim the parts do not support (the model's "oven" beside dish racks) is a
// conflict too; "unknown" or no claim is not.
function categoryFromVisibleParts(claimed: string, visibleParts: readonly string[]): string | null {
  const listed = visibleParts.map(fold)
  const matched = VISIBLE_PARTS.filter((entry) => listed.some((item) => entry.parts.some((part) => findSpans(item, part).length > 0)))
  if (matched.length !== 1) return null
  const claim = canonicalCategory(claimed)
  if (claim === '' || GENERIC_CATEGORIES.has(claim)) return matched[0].claims[0]
  return matched[0].claims.includes(claim) ? claim : null
}

function groundedApplianceType(
  claimed: string,
  evidence: string,
  visibleParts: readonly string[],
  model: string | null,
  prefixes: readonly { prefix: string; category: string }[],
): string {
  const printed = printedCategories(evidence, claimed)
  if (printed.length === 1) return printed[0]
  if (printed.length > 1) return 'unknown'
  return categoryFromModelPrefix(model, evidence, prefixes) ?? categoryFromVisibleParts(claimed, visibleParts) ?? 'unknown'
}

function partsList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 12).flatMap((item) => text(item) ?? [])
}

// KEE-60: every quoted category is a valid proposal. RF-350: the quote decides the category.
// A model number is not a category unless its prefix is on the certain list, which is empty.
// With no printed category, Keeply names it only from listed parts that belong to one kind.
export function normaliseIdentity(
  raw: unknown,
  prefixes: readonly { prefix: string; category: string }[] = CERTAIN_MODEL_PREFIXES,
): ApplianceIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const claimed = typeof r.applianceType === 'string' ? r.applianceType : ''
  const evidence = typeof r.typeEvidence === 'string' ? r.typeEvidence : ''
  const model = text(r.model, 40)
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0
  return {
    applianceType: groundedApplianceType(claimed, evidence, partsList(r.visibleParts), model, prefixes),
    manufacturer: text(r.manufacturer),
    model,
    serialNumber: text(r.serialNumber, 40),
    confidence,
  }
}
