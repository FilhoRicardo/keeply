import { evidenceExplanation, evidenceLabel, evidenceRank, type EvidenceLevel } from '@/domain/evidence'

const ICON: Record<EvidenceLevel, string> = {
  manufacturer_verified: '✓',
  similar_model: '≈',
  general_guidance: 'i',
}

// Each level has its own colour, icon and wording, so inferred or general guidance never reads as verified.
export function EvidenceBadge({ level, explain = false }: { level: EvidenceLevel; explain?: boolean }) {
  return (
    <div className={`evidence evidence--${level}`}>
      <span className="evidence-badge">
        <span className="evidence-icon" aria-hidden="true">
          {ICON[level]}
        </span>
        <span>
          <span className="visually-hidden">Evidence level {evidenceRank(level)}: </span>
          {evidenceLabel(level)}
        </span>
      </span>
      {explain && <p className="evidence-explanation">{evidenceExplanation(level)}</p>}
    </div>
  )
}
