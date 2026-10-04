'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { applianceName } from '@/domain/calendar-event'
import { formatInterval } from '@/domain/format-interval'
import { isOverdue, nextDue } from '@/domain/schedule'
import { EvidenceBadge } from '../../components/evidence-badge'
import { NotFoundPanel } from '../../components/screen'
import { connectUrl, fetchCalendarStatus, pendingCalendarTasks, writeApprovedTasks, type CalendarStatus } from '../../lib/calendar-client'
import { addCompletion, findRecord, recordCalendarResults } from '../../lib/plan-state'
import { updatePlanState, usePlanState } from '../../lib/plan-store'
import { formatDate } from '../../lib/format-date'
import { today } from '../../lib/today'

const OUTCOME_COPY: Record<string, string> = {
  calendar: 'Plan approved. Your tasks are in Google Calendar.',
  partial: 'Plan approved. Some tasks could not be added to Google Calendar; try again below.',
  saved: 'Plan approved and saved on this device.',
  not_connected: 'Plan approved. Reconnect Google Calendar to add your tasks.',
  failed: 'Plan approved, but Google Calendar could not be reached. Try again below.',
}

export function ApplianceRecordView({ applianceId }: { applianceId: string }) {
  const state = usePlanState()
  const outcome = useSearchParams().get('approved')
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchCalendarStatus().then(setCalendar)
  }, [])

  if (!state) return null
  const record = findRecord(state, applianceId)
  if (!record) return <NotFoundPanel />

  if (!record.approvedAt) {
    return (
      <div className="empty-state aster-inner">
        <div>
          <h3>No plan approved yet.</h3>
          <p>
            <Link href={`/appliances/${applianceId}/plan`}>Review the proposed plan</Link>
          </p>
        </div>
      </div>
    )
  }

  const now = today()
  const approved = record.tasks.filter((t) => t.status === 'approved')
  const pending = pendingCalendarTasks(record)

  async function retry() {
    setBusy(true)
    const result = await writeApprovedTasks(record!)
    if (result.kind === 'written') {
      updatePlanState((s) => recordCalendarResults(s, applianceId, result.results))
      setMessage(result.results.every((r) => r.ok) ? 'Added to Google Calendar.' : 'Some tasks still failed. Try again later.')
    } else {
      setMessage(result.kind === 'not_connected' ? 'Connect Google Calendar first.' : 'Google Calendar could not be reached.')
      if (result.kind === 'not_connected') setCalendar((c) => (c ? { ...c, connected: false } : c))
    }
    setBusy(false)
  }

  return (
    <>
      {outcome && OUTCOME_COPY[outcome] && (
        <p className="notice" role="status">
          {OUTCOME_COPY[outcome]}
        </p>
      )}

      <section className="plan-intro aster-inner" aria-label="Appliance">
        <p className="aster-eyebrow">Dishwasher</p>
        <h2>{applianceName(record.appliance)}</h2>
        <dl className="identity">
          <div>
            <dt>Manufacturer</dt>
            <dd>{record.appliance.manufacturer}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{record.appliance.model ?? 'Not entered'}</dd>
          </div>
          {record.appliance.serialNumber && (
            <div>
              <dt>Serial</dt>
              <dd>{record.appliance.serialNumber}</dd>
            </div>
          )}
        </dl>
      </section>

      <h2 className="section-title">Maintenance plan</h2>
      <ul className="summary-list">
        {approved.map((task) => {
          const rec = record.recommendations.find((r) => r.id === task.recommendationId)!
          const due = nextDue(task, record.completions)
          const history = record.completions
            .filter((c) => c.taskId === task.id)
            .sort((a, b) => b.completedOn.localeCompare(a.completedOn))
          return (
            <li key={task.id} className="summary-item aster-glass">
              <h3>{rec.taskName}</h3>
              <dl>
                <div>
                  <dt>Next due</dt>
                  <dd className={isOverdue(due, now) ? 'overdue' : undefined}>
                    {formatDate(due)}
                    {isOverdue(due, now) && ' (overdue)'}
                  </dd>
                </div>
                <div>
                  <dt>Your schedule</dt>
                  <dd>
                    {formatInterval(task.userInterval)}
                    {task.schedulingMode === 'completion_based' ? ', counted from when you do it' : ', fixed dates'}
                  </dd>
                </div>
                <div>
                  <dt>Recommendation</dt>
                  <dd>
                    {formatInterval(rec.recommendedInterval)}
                  </dd>
                </div>
                <div>
                  <dt>Calendar</dt>
                  <dd>{task.calendarEventId ? 'In Google Calendar' : 'Not added yet'}</dd>
                </div>
              </dl>
              <EvidenceBadge level={rec.evidenceLevel} />
              {history.length > 0 && (
                <p className="history">
                  <span className="aster-eyebrow">Done</span> {history.map((c) => formatDate(c.completedOn)).join(', ')}
                </p>
              )}
              <button
                type="button"
                className="aster-btn aster-btn--ghost full-width"
                onClick={() => updatePlanState((s) => addCompletion(s, applianceId, task.id, now))}
              >
                Mark done today
              </button>
            </li>
          )
        })}
      </ul>

      {pending.length > 0 && (
        <section className="calendar-panel aster-inner" aria-label="Google Calendar">
          <p>
            {pending.length} approved {pending.length === 1 ? 'task is' : 'tasks are'} not in Google Calendar yet.
          </p>
          {calendar?.connected ? (
            <button type="button" className="aster-btn aster-btn--primary full-width" disabled={busy} onClick={retry}>
              Add to Google Calendar
            </button>
          ) : calendar?.configured ? (
            <a className="aster-btn aster-btn--ghost full-width" href={connectUrl(`/appliances/${applianceId}`)}>
              Connect Google Calendar
            </a>
          ) : calendar ? (
            <p>Google Calendar is not set up on this server yet.</p>
          ) : null}
          {message && <p role="status">{message}</p>}
        </section>
      )}
    </>
  )
}
