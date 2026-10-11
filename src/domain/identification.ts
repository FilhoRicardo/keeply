// Phase 2 groundwork: identifying an appliance from a photo of its label.
// A recogniser only proposes; the owner always confirms or corrects before anything is saved.
// KEE-60: any household appliance, not only dishwashers. The `category` field is free text
// (e.g. "dishwasher", "fridge", "washing machine") or 'unknown'; it is never persisted.

export type ApplianceCategory = string

export const UNKNOWN_CATEGORY: ApplianceCategory = 'unknown'

// True when the photo did not yield a category the owner can confirm as-is.
export function isUnknownCategory(category: string | null | undefined): boolean {
  return !category || category.trim().toLowerCase() === UNKNOWN_CATEGORY
}

export type IdentificationSource = 'manual' | 'photo_recognition'

export type ApplianceIdentification = {
  category: ApplianceCategory
  manufacturer: string
  model: string
  serialNumber: string
  // 0..1 from a recogniser; null when the owner typed it.
  confidence: number | null
  source: IdentificationSource
}

export type RecognitionResult = {
  // A proposal for the owner to confirm, edit or rescan; null when nothing usable was read.
  identification: ApplianceIdentification | null
  // Why there is no proposal. Invite and limit refusals mean nothing was sent to a provider.
  // `ai_unavailable` also covers a provider error or timeout after the photo was sent: the
  // browser gets this notice only, never the provider's error. KEE-60: an "other" appliance
  // is a valid appliance, not a refusal — the proposal is shown and the owner confirms.
  notice: AccessDenial | null
}

// 'not_a_dishwasher' was retired in KEE-60. `ai_unavailable` is the honest "the AI service
// did not answer" notice, including a thrown or timed-out provider call (RF-348).
export const ACCESS_DENIALS = ['no_invite', 'tester_limit', 'daily_limit', 'ai_unavailable'] as const
export type AccessDenial = (typeof ACCESS_DENIALS)[number]
export type RecognitionNotice = AccessDenial

export function isAccessDenial(notice: RecognitionNotice | null): notice is AccessDenial {
  return (ACCESS_DENIALS as readonly string[]).includes(notice ?? '')
}

export interface ApplianceRecognizer {
  // Never throws for "not recognised"; returns an empty result instead.
  recognise(photo: Blob): Promise<RecognitionResult>
}

export const NOTHING_RECOGNISED: RecognitionResult = { identification: null, notice: null }

// Manual mode: nothing is recognised and the owner types what is on the label.
export const noRecognizer: ApplianceRecognizer = {
  recognise: async () => NOTHING_RECOGNISED,
}

// KEE-60: free-text category now. The owner's default is "dishwasher" only because the
// pre-KEE-60 flow taught it; any household appliance is supported.
export function emptyIdentification(): ApplianceIdentification {
  return { category: 'dishwasher', manufacturer: '', model: '', serialNumber: '', confidence: null, source: 'manual' }
}

// Any edit by the owner makes the identification theirs: a recogniser's confidence no longer applies.
export function editIdentification(
  current: ApplianceIdentification,
  change: Partial<Pick<ApplianceIdentification, 'category' | 'manufacturer' | 'model' | 'serialNumber'>>,
): ApplianceIdentification {
  return { ...current, ...change, confidence: null, source: 'manual' }
}

// `allowUnknownCategory` is only for a proposal still on its way to the confirm screen.
// Saving requires the owner to name the appliance.
export function validateIdentification(
  id: ApplianceIdentification,
  options?: { allowUnknownCategory?: boolean },
): string | null {
  const category = id.category.trim()
  if (category.length === 0 || (!options?.allowUnknownCategory && isUnknownCategory(category))) {
    return 'Name the appliance, for example Dishwasher or Fridge.'
  }
  if (id.manufacturer.trim().length === 0) return 'Enter the manufacturer, for example Bosch.'
  if (id.confidence !== null && (id.confidence < 0 || id.confidence > 1)) return 'Confidence must be between 0 and 1.'
  return null
}

// True when the appliance has the only hand-curated general-guidance list (dishwashers). Other
// appliance types do not get an invented plan: they fall back to "no plan found" unless a manual
// was located. Used by the proposer and the UI. KEE-60 owner decision (KEE-59).
export function isDishwasherCategory(category: ApplianceCategory | null | undefined): boolean {
  return typeof category === 'string' && category.trim().toLowerCase() === 'dishwasher'
}

// Fit an image inside a square of `maxEdge` pixels, never enlarging it.
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
