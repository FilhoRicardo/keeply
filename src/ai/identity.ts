// Keeply's provider-neutral appliance identity. Every AI adapter returns exactly this shape;
// provider request/response formats never leave their adapter. KEE-60: any household appliance,
// not only dishwashers. `applianceType` is the model's best read of the appliance category
// (e.g. "dishwasher", "fridge", "washing machine") or "unknown". The pre-KEE-60 "other"
// refusal signal is gone: every appliance is a valid proposal for the owner to confirm.
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
// KEE-60: the prompt no longer assumes a dishwasher. The model reads the rating label and
// reports the appliance category it sees in the photo.
export const IDENTITY_INSTRUCTIONS = `You read the rating label of a household appliance from a photo.
Reply with only one JSON object, no other text:
{"applianceType": string, "manufacturer": string | null, "model": string | null, "serialNumber": string | null, "confidence": number}
Rules: report the appliance category you can see in the photo (e.g. "dishwasher", "fridge", "washing machine", "oven", "dryer") or "unknown" if you cannot tell; copy text exactly as printed on the label; use null for anything not clearly legible; never guess a model or serial number; confidence is 0 to 1 for how sure you are of manufacturer and model together.`

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

// Parses the balanced {...} span starting at `start`; undefined when it is unbalanced or not JSON.
function balancedObjectAt(reply: string, start: number): unknown {
  let depth = 0
  let inString = false
  for (let i = start; i < reply.length; i++) {
    const ch = reply[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try {
        return JSON.parse(reply.slice(start, i + 1))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

// KEE-60: every recognised category is a valid proposal. The category is normalised to
// lowercase trimmed text or "unknown" so the rest of Keeply can branch on it consistently.
export function normaliseIdentity(raw: unknown): ApplianceIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = typeof r.applianceType === 'string' ? r.applianceType.trim().toLowerCase() : ''
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0
  return {
    applianceType: type.length > 0 ? type : 'unknown',
    manufacturer: text(r.manufacturer),
    model: text(r.model, 40),
    serialNumber: text(r.serialNumber, 40),
    confidence,
  }
}