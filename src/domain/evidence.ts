// The three Evidence levels. Inferred and general guidance must never read as verified.
export const EVIDENCE_LEVELS = ['manufacturer_verified', 'similar_model', 'general_guidance'] as const

export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number]

type EvidenceCopy = { rank: 1 | 2 | 3; label: string; explanation: string }

const COPY: Record<EvidenceLevel, EvidenceCopy> = {
  manufacturer_verified: {
    rank: 1,
    label: 'Manufacturer verified',
    explanation: 'Quoted from the manufacturer’s own documentation for your model.',
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

type SourceForEvidence = { type: string; url: string | null; quote: string | null }

const isManufacturerSource = (type: string) => type === 'manufacturer_manual' || type === 'manufacturer_website'

// Why a claimed evidence level is not backed by its source, or null when it is.
// Manufacturer verified needs a manufacturer document with a public https link and the document's
// own words (checked against the document by whoever produced the proposal). Similar-model guidance
// needs a manufacturer or similar-model source. General guidance needs only a source.
export function unsupportedEvidence(level: EvidenceLevel, source: SourceForEvidence): string | null {
  if (level === 'manufacturer_verified') {
    if (!isManufacturerSource(source.type)) return 'Manufacturer verified needs a manufacturer manual or website as its source.'
    if (!source.url?.startsWith('https://')) return 'Manufacturer verified needs a public https link to the document.'
    if (!source.quote?.trim()) return 'Manufacturer verified needs a quote from the document.'
  }
  if (level === 'similar_model' && !isManufacturerSource(source.type) && source.type !== 'similar_model_manual') {
    return 'Similar-model guidance needs a manufacturer or similar-model source.'
  }
  return null
}
