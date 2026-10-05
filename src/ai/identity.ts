// Keeply's provider-neutral appliance identity. Every AI adapter returns exactly this shape;
// provider request/response formats never leave their adapter.
export type ApplianceIdentity = {
  applianceType: 'dishwasher' | 'other' | 'unknown'
  manufacturer: string | null
  model: string | null
  serialNumber: string | null
  // 0..1, the provider's own estimate. A proposal only: the owner confirms or corrects.
  confidence: number
}

export type LabelPhoto = { bytes: Uint8Array; mimeType: string }

// What adapters ask the model for. Kept here so every provider asks the same question.
export const IDENTITY_INSTRUCTIONS = `You read the rating label of a household appliance from a photo.
Reply with only one JSON object, no other text:
{"applianceType": "dishwasher" | "other" | "unknown", "manufacturer": string | null, "model": string | null, "serialNumber": string | null, "confidence": number}
Rules: the owner says this is a dishwasher, and a label alone rarely names the appliance, so use "dishwasher" unless the photo clearly shows a different appliance, "other" only then, and "unknown" if you cannot tell; copy text exactly as printed on the label; use null for anything not clearly legible; never guess a model or serial number; confidence is 0 to 1 for how sure you are of manufacturer and model together.`

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

// Turns whatever a model returned into Keeply's schema, or null when it is unusable.
export function normaliseIdentity(raw: unknown): ApplianceIdentity | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const type = typeof r.applianceType === 'string' ? r.applianceType.toLowerCase() : 'unknown'
  const confidence = typeof r.confidence === 'number' && Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0
  return {
    applianceType: type === 'dishwasher' || type === 'other' ? type : 'unknown',
    manufacturer: text(r.manufacturer),
    model: text(r.model, 40),
    serialNumber: text(r.serialNumber, 40),
    confidence,
  }
}
