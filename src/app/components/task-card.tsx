'use client'

import { useState } from 'react'
import { presentInterval } from '@/domain/cadence'
import { presentCoveredSource, similarModelNotice } from '@/domain/model-family'
import type { MaintenanceTask } from '@/domain/model'
import type { Decision } from '@/domain/plan'
import { EvidenceBadge } from './evidence-badge'

const STATUS_COPY: Record<MaintenanceTask['status'], string> = {
  proposed: 'Not decided yet',
  accepted: 'Accepted: goes to your calendar when you approve',
  rejected: 'Rejected: will not be added',
}

function howOften(task: MaintenanceTask): string {
  return presentInterval({
    quote: task.source.quote,
    stored: task.interval,
    generalGuidance: task.evidenceLevel === 'general_guidance',
  }).text
}

// The third-party sentence, only when the covered model is the owner's exact model.
function exactCopyNotice(ownerModel: string | null | undefined, coveredModel: string): string | null {
  const notice = similarModelNotice(ownerModel, coveredModel)
  return notice === similarModelNotice(coveredModel, coveredModel) ? notice : null
}

function sourceHost(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

// Similar-model tasks name the covered model and say plainly that the guidance is not verified.
export function SimilarModelNote({ task, ownerModel }: { task: MaintenanceTask; ownerModel?: string | null }) {
  if (task.evidenceLevel !== 'similar_model') return null
  const covered = presentCoveredSource(task.source).coveredModel
  if (!covered) return null
  return (
    <div className="similar-model-note">
      <p>{similarModelNotice(ownerModel, covered)}</p>
      <p>
        <span className="aster-eyebrow">Covered model</span> <span className="covered-model">{covered}</span>
      </p>
    </div>
  )
}

// Where the task comes from: title, page, the document's own words and a link.
export function SourceDetails({
  task,
  ownerModel,
  note = true,
}: {
  task: MaintenanceTask
  ownerModel?: string | null
  note?: boolean
}) {
  const { source } = task
  const presented = presentCoveredSource(source)
  const host = task.evidenceLevel === 'similar_model' ? sourceHost(source.url) : null
  const thirdPartyNotice =
    task.evidenceLevel === 'similar_model' && presented.coveredModel
      ? exactCopyNotice(ownerModel, presented.coveredModel)
      : null
  return (
    <div className="source-panel aster-inner">
      <EvidenceBadge
        level={task.evidenceLevel}
        explain={thirdPartyNotice === null || !note}
        explanation={thirdPartyNotice && !note ? thirdPartyNotice : undefined}
      />
      {note && <SimilarModelNote task={task} ownerModel={ownerModel} />}
      {host && (
        <p>
          <span className="aster-eyebrow">Host</span> <span className="source-host">{host}</span>
        </p>
      )}
      <p>
        <span className="aster-eyebrow">Source</span> {[source.title, presented.location].filter(Boolean).join(', ')}
        {source.url && (
          <>
            {' '}
            <a href={source.url} target="_blank" rel="noreferrer">
              Open
            </a>
          </>
        )}
      </p>
      {source.quote && <blockquote className="source-quote">“{source.quote}”</blockquote>}
    </div>
  )
}

// One proposed task: what to do, how often, how sure Keeply is and why; Accept or Reject.
export function TaskCard({
  task,
  ownerModel,
  onDecide,
}: {
  task: MaintenanceTask
  ownerModel?: string | null
  onDecide: (decision: Decision | null) => void
}) {
  const [showSource, setShowSource] = useState(false)
  const headingId = `task-${task.id}`
  const choose = (decision: Decision) => onDecide(task.status === decision ? null : decision)

  return (
    <article className={`plan-card aster-glass plan-card--${task.status}`} aria-labelledby={headingId}>
      <h3 id={headingId}>{task.name}</h3>
      <p className="recommended">
        <span className="aster-eyebrow">How often</span>
        <strong>{howOften(task)}</strong>
      </p>
      <EvidenceBadge level={task.evidenceLevel} />
      <SimilarModelNote task={task} ownerModel={ownerModel} />
      <p className="plan-card-description">{task.instructions}</p>

      <button type="button" className="link-button" aria-expanded={showSource} onClick={() => setShowSource((s) => !s)}>
        Why? / View source
      </button>
      {showSource && <SourceDetails task={task} ownerModel={ownerModel} note={false} />}

      <p className="decision-status" aria-live="polite">
        {STATUS_COPY[task.status]}
      </p>
      <div className="decision-row" role="group" aria-label={`Decision for ${task.name}`}>
        <button type="button" className="decision" aria-pressed={task.status === 'accepted'} onClick={() => choose('accepted')}>
          Accept
        </button>
        <button type="button" className="decision" aria-pressed={task.status === 'rejected'} onClick={() => choose('rejected')}>
          Reject
        </button>
      </div>
    </article>
  )
}
