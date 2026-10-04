'use client'

import { useState } from 'react'
import type { LocalDate } from '@/domain/dates'
import { formatInterval } from '@/domain/format-interval'
import type { Recommendation } from '@/domain/model'
import { DEFAULT_SCHEDULING_MODE, type Decision } from '@/domain/plan'
import { formatDate } from '../lib/format-date'
import { CustomiseForm } from './customise-form'
import { EvidenceBadge } from './evidence-badge'

export function describeDecision(decision: Decision | undefined): string {
  if (!decision) return 'Not decided yet'
  if (decision.kind === 'include') return 'Included as recommended'
  if (decision.kind === 'skip') return 'Skipped'
  const timing = decision.schedulingMode === 'completion_based' ? ', counted from when you do it' : ''
  return `Customised: ${formatInterval(decision.interval)} from ${formatDate(decision.startDate)}${timing}`
}

export function RecommendationCard({
  recommendation,
  decision,
  today,
  onDecide,
}: {
  recommendation: Recommendation
  decision: Decision | undefined
  today: LocalDate
  onDecide: (decision: Decision | null) => void
}) {
  const [customising, setCustomising] = useState(false)
  const [showSource, setShowSource] = useState(false)
  const headingId = `rec-${recommendation.id}`
  const source = [recommendation.source.title, recommendation.sourceLocation].filter(Boolean).join(', ')

  const initial =
    decision?.kind === 'customise'
      ? decision
      : { interval: { ...recommendation.recommendedInterval }, startDate: today, schedulingMode: DEFAULT_SCHEDULING_MODE }

  return (
    <article className={`plan-card aster-glass plan-card--${decision?.kind ?? 'pending'}`} aria-labelledby={headingId}>
      <h3 id={headingId}>{recommendation.taskName}</h3>
      <p className="recommended">
        <span className="aster-eyebrow">Recommendation</span>
        <strong>{formatInterval(recommendation.recommendedInterval)}</strong>
      </p>
      <EvidenceBadge level={recommendation.evidenceLevel} />
      <p className="plan-card-description">{recommendation.description}</p>

      <button
        type="button"
        className="link-button"
        aria-expanded={showSource}
        onClick={() => setShowSource((s) => !s)}
      >
        Why? / View source
      </button>
      {showSource && (
        <div className="source-panel aster-inner">
          <EvidenceBadge level={recommendation.evidenceLevel} explain />
          <p>
            <span className="aster-eyebrow">Source</span> {source}
            {recommendation.source.reference && (
              <>
                {' '}
                <a href={recommendation.source.reference} target="_blank" rel="noreferrer">
                  Open
                </a>
              </>
            )}
          </p>
        </div>
      )}

      <p className="decision-status" aria-live="polite">
        {describeDecision(decision)}
      </p>

      {customising ? (
        <CustomiseForm
          initial={initial}
          onCancel={() => setCustomising(false)}
          onSave={(c) => {
            onDecide({ kind: 'customise', ...c })
            setCustomising(false)
          }}
        />
      ) : (
        <div className="decision-row" role="group" aria-label={`Decision for ${recommendation.taskName}`}>
          <button
            type="button"
            className="decision"
            aria-pressed={decision?.kind === 'include'}
            onClick={() => onDecide({ kind: 'include' })}
          >
            Include
          </button>
          <button
            type="button"
            className="decision"
            aria-pressed={decision?.kind === 'customise'}
            onClick={() => setCustomising(true)}
          >
            Customise
          </button>
          <button
            type="button"
            className="decision"
            aria-pressed={decision?.kind === 'skip'}
            onClick={() => onDecide({ kind: 'skip' })}
          >
            Skip
          </button>
        </div>
      )}
    </article>
  )
}
