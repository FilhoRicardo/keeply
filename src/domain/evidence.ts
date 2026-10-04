// The three Evidence levels. Inferred and general guidance must never read as verified.
export const EVIDENCE_LEVELS = ['manufacturer_verified', 'similar_model', 'general_guidance'] as const

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number]

type EvidenceCopy = { rank: 1 | 2 | 3; label: string; explanation: string }

const COPY: Record<EvidenceLevel, EvidenceCopy> = {
  manufacturer_verified: {
    rank: 1,
    label: 'Manufacturer verified',
    explanation: 'From documentation for your exact model or an authoritative manufacturer source.',
  },
  similar_model: {
    rank: 2,
    label: 'Similar-model guidance',
    explanation:
      'We could not verify this for your exact model. Comparable models in the same product family recommend it.',
  },
  general_guidance: {
    rank: 3,
    label: 'General guidance',
    explanation:
      'We could not find model-specific guidance. This is common practice for dishwashers in general.',
  },
}

export function evidenceLabel(level: EvidenceLevel): string {
  return COPY[level].label
}

export function evidenceExplanation(level: EvidenceLevel): string {
  return COPY[level].explanation
}

export function evidenceRank(level: EvidenceLevel): 1 | 2 | 3 {
  return COPY[level].rank
}

export function isManufacturerVerified(level: EvidenceLevel): boolean {
  return level === 'manufacturer_verified'
}

type SourceForEvidence = { sourceType: string; modelScope: string | null }

// Letters and digits only, upper case: "SMS 6ZCI-49E" and "sms6zci49e" are the same model.
export const normaliseModel = (model: string) => model.toUpperCase().replace(/[^A-Z0-9]/g, '')

// Why a claimed evidence level is not backed by its source, or null when it is.
// Manufacturer verified needs a manufacturer source scoped to this exact model; similar-model
// guidance needs a manufacturer or similar-model source. General guidance needs only a source.
export function unsupportedEvidence(
  level: EvidenceLevel,
  source: SourceForEvidence,
  applianceModel: string | null,
): string | null {
  const manufacturerSource = source.sourceType === 'manufacturer_manual' || source.sourceType === 'manufacturer_website'
  if (level === 'manufacturer_verified') {
    if (!manufacturerSource) return 'Manufacturer verified needs a manufacturer manual or website as its source.'
    if (!applianceModel || !source.modelScope) return 'Manufacturer verified needs a known model on both the appliance and the source.'
    if (normaliseModel(source.modelScope) !== normaliseModel(applianceModel)) {
      return 'Manufacturer verified needs a source for this exact model.'
    }
  }
  if (level === 'similar_model' && !manufacturerSource && source.sourceType !== 'similar_model_manual') {
    return 'Similar-model guidance needs a manufacturer or similar-model source.'
  }
  return null
}
