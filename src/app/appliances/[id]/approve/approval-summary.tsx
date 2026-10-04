'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { applianceName } from '@/domain/calendar-event'
import { isLocalDate } from '@/domain/dates'
import { formatInterval } from '@/domain/format-interval'
import { canApprove } from '@/domain/plan'
import { EvidenceBadge } from '../../../components/evidence-badge'
import { LoadingPanel, NotFoundPanel } from '../../../components/screen'
import { connectUrl, fetchCalendarStatus, writeApprovedTasks, type CalendarStatus } from '../../../lib/calendar-client'
import { usePlan } from '../../../lib/plan-context'
import { findRecord } from '../../../lib/plan-state'
import { formatDate } from '../../../lib/format-date'
import { today } from '../../../lib/today'

export function ApprovalSummary({ applianceId }: { applianceId: string }) {
  const router = useRouter()
  const { state, approve, recordCalendarResults, accessToken } = usePlan()
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
          <h3>This plan is already approved.</h3>
          <p>
            <Link href={`/appliances/${applianceId}`}>View your dishwasher</Link>
          </p>
        </div>
      </div>
    )
  }

  const kept = record.recommendations.filter((r) => record.decisions[r.id] && record.decisions[r.id].kind !== 'skip')
  const skipped = record.recommendations.filter((r) => record.decisions[r.id]?.kind === 'skip')
  const usesDefaultStart = kept.some((r) => record.decisions[r.id].kind === 'include')
  const ready = canApprove(record.recommendations, record.decisions) && isLocalDate(startDate)
  const returnTo = `/appliances/${applianceId}/approve`

  async function onApprove() {
    setBusy(true)
    // Approval: the only place Tasks are created.
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
      const result = await writeApprovedTasks(findRecord(approved, applianceId)!, await accessToken())
      if (result.kind === 'written') {
        const after = findRecord(await recordCalendarResults(applianceId, result.results), applianceId)!
        outcome = after.tasks.every((t) => t.status !== 'approved' || t.calendarEventId) ? 'calendar' : 'partial'
      } else {
        outcome = result.kind
      }
    }
    router.push(`/appliances/${applianceId}?approved=${outcome}`)
  }

  return (
    <>
      <section className="plan-intro aster-inner">
        <p className="aster-eyebrow">Plan for</p>
        <h2>{applianceName(record.appliance)}</h2>
        <p>
          {kept.length} {kept.length === 1 ? 'task' : 'tasks'} will be added to your calendar
          {skipped.length > 0 && `, ${skipped.length} skipped`}.
        </p>
      </section>

      <ul className="summary-list" aria-label="Tasks to add">
        {kept.map((rec) => {
          const decision = record.decisions[rec.id]
          const custom = decision.kind === 'customise' ? decision : null
          return (
            <li key={rec.id} className="summary-item aster-glass">
              <h3>{rec.taskName}</h3>
              <dl>
                <div>
                  <dt>Your schedule</dt>
                  <dd>
                    {formatInterval(custom?.interval ?? rec.recommendedInterval)}
                    {custom ? ` from ${formatDate(custom.startDate)}` : ''}
                    {custom?.schedulingMode === 'completion_based' && ', counted from when you do it'}
                  </dd>
                </div>
                <div>
                  <dt>Recommendation</dt>
                  <dd>{formatInterval(rec.recommendedInterval)}</dd>
                </div>
              </dl>
              <EvidenceBadge level={rec.evidenceLevel} />
            </li>
          )
        })}
      </ul>

      {skipped.length > 0 && (
        <p className="skipped-note">
          <span className="aster-eyebrow">Skipped</span> {skipped.map((r) => r.taskName).join(', ')}
        </p>
      )}

      {usesDefaultStart && (
        <label className="field aster-inner start-field">
          <span>Start included tasks on</span>
          <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </label>
      )}

      <section className="calendar-panel aster-inner" aria-label="Google Calendar">
        {calendar === null && <p>Checking Google Calendar…</p>}
        {calendar?.connected && <p className="calendar-ok">Google Calendar connected.</p>}
        {calendar && !calendar.connected && calendar.configured && (
          <>
            <p>Connect Google Calendar so approved tasks can be added. Connecting adds nothing on its own.</p>
            <a className="aster-btn aster-btn--ghost full-width" href={connectUrl(returnTo)}>
              Connect Google Calendar
            </a>
          </>
        )}
        {calendar && !calendar.configured && (
          <p>Google Calendar is not set up on this server yet. Your approved plan will be saved on this device.</p>
        )}
      </section>

      <div className="plan-actions">
        <button
          type="button"
          className="aster-btn aster-btn--primary full-width"
          disabled={!ready || busy || calendar === null}
          onClick={onApprove}
        >
          {busy ? 'Approving…' : 'Approve maintenance plan'}
        </button>
        <Link className="link-button" href={`/appliances/${applianceId}/plan`}>
          Change decisions
        </Link>
      </div>
    </>
  )
}
