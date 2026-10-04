'use client'

import Link from 'next/link'
import { applianceName } from '@/domain/calendar-event'
import { approvalBlockers } from '@/domain/plan'
import { NotFoundPanel } from '../../../components/screen'
import { RecommendationCard } from '../../../components/recommendation-card'
import { findRecord, setDecision } from '../../../lib/plan-state'
import { updatePlanState, usePlanState } from '../../../lib/plan-store'
import { today } from '../../../lib/today'

const BLOCKER_COPY = {
  undecided: 'Choose Include, Customise or Skip for every task.',
  nothing_included: 'Include or customise at least one task.',
  invalid_customisation: 'Fix the customised task before continuing.',
}

export function PlanReview({ applianceId }: { applianceId: string }) {
  const state = usePlanState()
  if (!state) return null
  const record = findRecord(state, applianceId)
  if (!record) return <NotFoundPanel />

  if (record.approvedAt) {
    return (
      <div className="empty-state aster-inner">
        <div>
          <h3>This plan is approved.</h3>
          <p>
            <Link href={`/appliances/${applianceId}`}>View your dishwasher</Link>
          </p>
        </div>
      </div>
    )
  }

  const blockers = approvalBlockers(record.recommendations, record.decisions)
  const decided = record.recommendations.filter((r) => record.decisions[r.id]).length

  return (
    <>
      <section className="plan-intro aster-inner">
        <p className="aster-eyebrow">Proposed for</p>
        <h2>{applianceName(record.appliance)}</h2>
        <p>
          Keeply proposes; you decide. Nothing reaches your calendar until you approve the plan. These are general
          dishwasher tasks: we have not looked up your exact model yet.
        </p>
      </section>

      <div className="plan-list">
        {record.recommendations.map((rec) => (
          <RecommendationCard
            key={rec.id}
            recommendation={rec}
            decision={record.decisions[rec.id]}
            today={today()}
            onDecide={(decision) => updatePlanState((s) => setDecision(s, applianceId, rec.id, decision))}
          />
        ))}
      </div>

      <div className="plan-actions">
        <p className="progress aster-mono" aria-live="polite">
          {decided} of {record.recommendations.length} decided
        </p>
        {blockers.length > 0 ? (
          <>
            <p className="hint">{BLOCKER_COPY[blockers[0]]}</p>
            <button type="button" className="aster-btn aster-btn--primary full-width" disabled>
              Review plan
            </button>
          </>
        ) : (
          <Link className="aster-btn aster-btn--primary full-width" href={`/appliances/${applianceId}/approve`}>
            Review plan
          </Link>
        )}
      </div>
    </>
  )
}
