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
