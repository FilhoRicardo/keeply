// Keeply's provider-neutral appliance identity. Every AI adapter returns exactly this shape;
// provider request/response formats never leave their adapter. KEE-60: any household appliance,
// not only dishwashers. `applianceType` is a category the label prints, or a model-number
// prefix that is certain for one category. Otherwise it is "unknown". An ungrounded guess
// such as "oven" is not proposed. The owner still confirms or corrects the result.
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
// KEE-60: the prompt no longer assumes a dishwasher. RF-350: the category is only what the
// label prints. A guess, including a default of "oven", is "unknown".
export const IDENTITY_INSTRUCTIONS = `You read the rating label of a household appliance from a photo.
Reply with only one JSON object, no other text:
{"applianceType": string, "typeEvidence": string | null, "manufacturer": string | null, "model": string | null, "serialNumber": string | null, "confidence": number}
Rules:
- applianceType is the kind of appliance only when that kind is printed on the label (a word such as dishwasher, washing machine, refrigerator, oven or dryer). Copy those printed words into typeEvidence exactly.
- If the label does not print the kind of appliance, applianceType is "unknown" and typeEvidence is null.
- Do not guess a category. "oven" is not a default. An appliance you cannot classify from printed words is "unknown".
- A field labelled Type or Mod. that holds a model code is the model number, not the category.
- Copy manufacturer, model and serial exactly as printed. Use null when a field is not clearly legible. Never guess a model or serial number.
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

// Printed words that name one category. Every phrase is checked. Two different categories in
// the same quote are ambiguous and become "unknown".
const PRINTED_CATEGORIES: readonly [string, string][] = [
  ['washing machine', 'washing machine'],
  ['tumble dryer', 'dryer'],
  ['fridge freezer', 'fridge'],
  ['dish washer', 'dishwasher'],
  ['refrigerator', 'fridge'],
  ['dishwasher', 'dishwasher'],
  ['microwave', 'microwave'],
  ['dryer', 'dryer'],
  ['fridge', 'fridge'],
  ['oven', 'oven'],
]

// Smeg's service desk defines a DI model number as Dishwasher Integrated (their example is
// DI612). The prefix is the rule; individual model numbers are not listed. A prefix that is
// not certain for one category is left out, and the type stays "unknown".
const CERTAIN_MODEL_PREFIXES: readonly { manufacturer: string; model: RegExp; category: string }[] = [
  { manufacturer: 'smeg', model: /^DI\d/, category: 'dishwasher' },
]

function words(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 0)
}

function hasPhrase(text: string, phrase: string): boolean {
  const haystack = words(text)
  const needle = words(phrase)
  if (needle.length === 0 || haystack.length < needle.length) return false
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    const matches = needle.every((word, j) => {
      const found = haystack[i + j]
      return found === word || (j === needle.length - 1 && found === `${word}s`)
    })
    if (matches) return true
  }
  return false
}

// The category named by printed words. Ambiguous when the quote names more than one.
function categoryPrintedIn(evidence: string, claimed: string): string | 'ambiguous' | null {
  const found = new Set<string>()
  for (const [phrase, category] of PRINTED_CATEGORIES) {
    if (hasPhrase(evidence, phrase)) found.add(category)
  }
  if (found.size > 1) return 'ambiguous'
  if (found.size === 1) return [...found][0]
  const claim = claimed.trim().toLowerCase().replace(/\s+/g, ' ')
  if (claim.length >= 3 && claim !== 'unknown' && hasPhrase(evidence, claim)) return claim
  return null
}

function categoryFromModelPrefix(manufacturer: string | null, model: string | null): string | null {
  if (!manufacturer || !model) return null
  const brand = manufacturer.trim().toLowerCase()
  const code = model.toUpperCase().replace(/\s+/g, '')
  const match = CERTAIN_MODEL_PREFIXES.find((prefix) => prefix.manufacturer === brand && prefix.model.test(code))
  return match?.category ?? null
}

// Printed words win. A certain prefix fills in a missing category. When the two disagree, or
// the quote names two categories, the type is "unknown" rather than a confident guess.
function groundedCategory(printed: string | 'ambiguous' | null, prefixed: string | null): string {
  if (printed === 'ambiguous') return 'unknown'
  if (printed && prefixed && printed !== prefixed) return 'unknown'
  return printed ?? prefixed ?? 'unknown'
}

// KEE-60: every grounded category is a valid proposal. RF-350: a category the label does not
// support is "unknown", so the confirm screen can ask the owner. The guess itself is dropped.
export function normaliseIdentity(raw: unknown): ApplianceIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const claimed = typeof r.applianceType === 'string' ? r.applianceType : ''
  const evidence = typeof r.typeEvidence === 'string' && r.typeEvidence.trim().length > 0 ? r.typeEvidence : null
  const manufacturer = text(r.manufacturer)
  const model = text(r.model, 40)
  const printed = evidence ? categoryPrintedIn(evidence, claimed) : null
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0
  return {
    applianceType: groundedCategory(printed, categoryFromModelPrefix(manufacturer, model)),
    manufacturer,
    model,
    serialNumber: text(r.serialNumber, 40),
    confidence,
  }
}
