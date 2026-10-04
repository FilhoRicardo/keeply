// Phase 2 groundwork: identifying an appliance from a photo of its label.
// A recogniser only proposes; the owner always confirms or corrects before anything is saved.

export type IdentificationSource = 'manual' | 'photo_recognition'

export type ApplianceIdentification = {
  category: 'dishwasher'
  manufacturer: string
  model: string
  serialNumber: string
  // 0..1 from a recogniser; null when the owner typed it.
  confidence: number | null
  source: IdentificationSource
}

export interface ApplianceRecognizer {
  // Resolves to null when nothing could be read. Never throws for "not recognised".
  recognise(photo: Blob): Promise<ApplianceIdentification | null>
}

// v0.1 has no AI: nothing is recognised and the owner types what is on the label.
export const noRecognizer: ApplianceRecognizer = {
  recognise: async () => null,
}

export function emptyIdentification(): ApplianceIdentification {
  return { category: 'dishwasher', manufacturer: '', model: '', serialNumber: '', confidence: null, source: 'manual' }
}

// Any edit by the owner makes the identification theirs: a recogniser's confidence no longer applies.
export function editIdentification(
  current: ApplianceIdentification,
  change: Partial<Pick<ApplianceIdentification, 'manufacturer' | 'model' | 'serialNumber'>>,
): ApplianceIdentification {
  return { ...current, ...change, confidence: null, source: 'manual' }
}

export function validateIdentification(id: ApplianceIdentification): string | null {
  if (id.category !== 'dishwasher') return 'Keeply supports dishwashers only for now.'
  if (id.manufacturer.trim().length === 0) return 'Enter the manufacturer, for example Bosch.'
  if (id.confidence !== null && (id.confidence < 0 || id.confidence > 1)) return 'Confidence must be between 0 and 1.'
  return null
}

// Fit an image inside a square of `maxEdge` pixels, never enlarging it.
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
