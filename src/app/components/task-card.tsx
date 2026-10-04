'use client'

import { useState } from 'react'
import { formatInterval } from '@/domain/format-interval'
import type { MaintenanceTask } from '@/domain/model'
import type { Decision } from '@/domain/plan'
import { EvidenceBadge } from './evidence-badge'

const STATUS_COPY: Record<MaintenanceTask['status'], string> = {
  proposed: 'Not decided yet',
  accepted: 'Accepted: goes to your calendar when you approve',
  rejected: 'Rejected: will not be added',
}

// Where the task comes from: title, page, the document's own words and a link.
export function SourceDetails({ task }: { task: MaintenanceTask }) {
  const { source } = task
  return (
    <div className="source-panel aster-inner">
      <EvidenceBadge level={task.evidenceLevel} explain />
      <p>
        <span className="aster-eyebrow">Source</span> {[source.title, source.location].filter(Boolean).join(', ')}
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
export function TaskCard({ task, onDecide }: { task: MaintenanceTask; onDecide: (decision: Decision | null) => void }) {
  const [showSource, setShowSource] = useState(false)
  const headingId = `task-${task.id}`
  const choose = (decision: Decision) => onDecide(task.status === decision ? null : decision)

  return (
    <article className={`plan-card aster-glass plan-card--${task.status}`} aria-labelledby={headingId}>
      <h3 id={headingId}>{task.name}</h3>
      <p className="recommended">
        <span className="aster-eyebrow">How often</span>
        <strong>{formatInterval(task.interval)}</strong>
      </p>
      <EvidenceBadge level={task.evidenceLevel} />
      <p className="plan-card-description">{task.instructions}</p>

      <button type="button" className="link-button" aria-expanded={showSource} onClick={() => setShowSource((s) => !s)}>
        Why? / View source
      </button>
      {showSource && <SourceDetails task={task} />}

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
