'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { applianceName } from '@/domain/calendar-event'
import { isLocalDate } from '@/domain/dates'
import { approvalBlockers } from '@/domain/plan'
import { CalendarPanel } from '../../../components/calendar-panel'
import { CalendarReturnNotice } from '../../../components/calendar-return-notice'
import { DeleteAppliance } from '../../../components/delete-appliance'
import { PlanFallbackBanner, planFallbackReason, type PlanFallbackReason } from '../../../components/plan-fallback-banner'
import { LoadingPanel, NotFoundPanel } from '../../../components/screen'
import { TaskCard } from '../../../components/task-card'
import { fetchCalendarStatus, writeApprovedTasks, type CalendarStatus } from '../../../lib/calendar-client'
import { usePlan } from '../../../lib/plan-context'
import { findRecord } from '../../../lib/plan-state'
import { today } from '../../../lib/today'

const BLOCKER_COPY = {
  undecided: 'Accept or reject every task.',
  nothing_accepted: 'Accept at least one task.',
}

function guidanceIntro(reason: PlanFallbackReason): string {
  if (reason === 'extraction_unavailable' || reason === 'timeout') {
    return 'These are general dishwasher tasks, not a manufacturer recommendation.'
  }
  if (reason === 'no_proposal_meta') {
    return 'These are general guidance tasks. They are not a manufacturer recommendation.'
  }
  return 'These are general guidance tasks: Keeply found no guidance for your exact model.'
}

// The proposed plan: Accept or Reject each task, pick a start date, approve. Only then are the
// accepted tasks written to Google Calendar.
//
// KEE-43: every task shows source, page and the verbatim quote (TaskCard). When the live search
// could not find a manufacturer manual, a PlanFallbackBanner explains why — the owner is never
// shown general-guidance tasks without the disclaimer.
export function PlanReview({ applianceId }: { applianceId: string }) {
  const router = useRouter()
  const { state, decide, approve, recordCalendarResults, accessToken, storageKind } = usePlan()
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [startDate, setStartDate] = useState(today)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchCalendarStatus().then(setCalendar)
  }, [])

  if (!state) return <LoadingPanel />
  const record = findRecord(state, applianceId)
  if (!record) return <NotFoundPanel />

  if (record.approvedAt) {
    return (
      <div className="empty-state aster-inner">
        <div>
          <h3>This plan is approved.</h3>
          <p>
            <Link href={`/appliances/${applianceId}`}>View your appliance</Link>
          </p>
        </div>
      </div>
    )
  }

  const blockers = approvalBlockers(record.tasks)
  const accepted = record.tasks.filter((t) => t.status === 'accepted').length
  const decided = record.tasks.filter((t) => t.status !== 'proposed').length
  const ready = blockers.length === 0 && isLocalDate(startDate) && calendar !== null && !busy
  const allGeneral = record.tasks.every((t) => t.evidenceLevel === 'general_guidance')
  const fallbackReason = planFallbackReason(record.proposalMeta)

  async function onApprove() {
    setBusy(true)
    let approved
    try {
      approved = await approve(applianceId, startDate)
    } catch {
      // Nothing was approved and nothing was written; the provider's banner shows why.
      setBusy(false)
      return
    }
    let outcome = 'saved'
    if (calendar?.connected) {
      try {
        const result = await writeApprovedTasks(findRecord(approved, applianceId)!, await accessToken())
        if (result.kind === 'written') {
          await recordCalendarResults(applianceId, result.results)
          outcome = result.results.every((r) => r.ok) ? 'calendar' : 'partial'
        } else {
          outcome = result.kind
        }
      } catch {
        // The plan is approved either way; writes are idempotent, so the appliance page can retry.
        outcome = 'failed'
      }
    }
    router.push(`/appliances/${applianceId}?approved=${outcome}`)
  }

  return (
    <>
      <section className="plan-intro aster-inner">
        <p className="aster-eyebrow">Proposed for</p>
        <h2>{applianceName(record.appliance)}</h2>
        <p>
          Keeply proposes; you decide. Nothing reaches your calendar until you approve.{' '}
          {allGeneral
            ? guidanceIntro(fallbackReason)
            : 'Each task shows where its guidance comes from and how closely it matches your model.'}
        </p>
      </section>

      {allGeneral && <PlanFallbackBanner meta={record.proposalMeta} />}

      <ul className="plan-list">
        {record.tasks.map((task) => (
          <li key={task.id}>
            <TaskCard
              task={task}
              ownerModel={record.appliance.model}
              onDecide={(d) => void decide(applianceId, task.id, d).catch(() => {})}
            />
          </li>
        ))}
      </ul>

      <label className="field aster-inner start-field">
        <span>First reminder on</span>
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>

      <CalendarReturnNotice />
      <CalendarPanel calendar={calendar} returnTo={`/appliances/${applianceId}/plan`} storageKind={storageKind} />

      <div className="plan-actions">
        <p className="progress aster-mono" aria-live="polite">
          {decided} of {record.tasks.length} decided
        </p>
        {blockers.length > 0 && <p className="hint">{BLOCKER_COPY[blockers[0]]}</p>}
        <button type="button" className="aster-btn aster-btn--primary full-width" disabled={!ready} onClick={onApprove}>
          {busy ? 'Approving…' : calendar?.connected ? `Approve and add ${accepted} ${accepted === 1 ? 'task' : 'tasks'} to Google Calendar` : 'Approve plan'}
        </button>
      </div>
      <DeleteAppliance applianceId={applianceId} name={applianceName(record.appliance)} hasCalendarEvents={false} />
    </>
  )
}
