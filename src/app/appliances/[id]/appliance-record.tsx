'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { applianceName } from '@/domain/calendar-event'
import { formatInterval } from '@/domain/format-interval'
import { pendingCalendarTasks } from '@/domain/plan'
import { CalendarPanel } from '../../components/calendar-panel'
import { CalendarReturnNotice } from '../../components/calendar-return-notice'
import { DeleteAppliance } from '../../components/delete-appliance'
import { EvidenceBadge } from '../../components/evidence-badge'
import { LoadingPanel, NotFoundPanel } from '../../components/screen'
import { SourceDetails } from '../../components/task-card'
import { disconnectCalendar, fetchCalendarStatus, writeApprovedTasks, type CalendarStatus } from '../../lib/calendar-client'
import { formatDate } from '../../lib/format-date'
import { usePlan } from '../../lib/plan-context'
import { findRecord } from '../../lib/plan-state'
import { localDay } from '../../lib/today'

const OUTCOME_COPY: Record<string, string> = {
  calendar: 'Plan approved. Your tasks are in Google Calendar.',
  partial: 'Plan approved. Some tasks could not be added to Google Calendar; try again below.',
  saved: 'Plan approved and saved.',
  not_connected: 'Plan approved. Reconnect Google Calendar to add your tasks.',
  failed: 'Plan approved, but Google Calendar could not be reached. Try again below.',
}

// The appliance after Approval: what was accepted and where it lives now. The owner manages the
// tasks in Google Calendar; Keeply only adds what is still missing.
export function ApplianceRecordView({ applianceId }: { applianceId: string }) {
  const { state, storageKind, recordCalendarResults, accessToken } = usePlan()
  const outcome = useSearchParams().get('approved')
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchCalendarStatus().then(setCalendar)
  }, [])

  if (!state) return <LoadingPanel />
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

  const { appliance } = record
  const accepted = record.tasks.filter((t) => t.status === 'accepted')
  const rejected = record.tasks.filter((t) => t.status === 'rejected')
  const pending = pendingCalendarTasks(record)

  async function addMissing() {
    setBusy(true)
    try {
      const result = await writeApprovedTasks(record!, await accessToken())
      if (result.kind === 'written') {
        await recordCalendarResults(applianceId, result.results)
        setMessage(result.results.every((r) => r.ok) ? 'Added to Google Calendar.' : 'Some tasks still failed. Try again later.')
      } else {
        setMessage(result.kind === 'not_connected' ? 'Connect Google Calendar first.' : 'Google Calendar could not be reached.')
        if (result.kind === 'not_connected') setCalendar((c) => (c ? { ...c, connected: false } : c))
      }
    } catch {
      // Storage failures surface in the provider's banner; writes are idempotent, so retrying is safe.
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {outcome && OUTCOME_COPY[outcome] && (
        <p className="notice" role="status">
          {OUTCOME_COPY[outcome]}
        </p>
      )}
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <section className="plan-intro aster-inner">
        <p className="aster-eyebrow">Appliance</p>
        <h2>{applianceName(appliance)}</h2>
        <dl className="identity">
          {appliance.serialNumber && (
            <div>
              <dt>Serial number</dt>
              <dd>{appliance.serialNumber}</dd>
            </div>
          )}
          <div>
            <dt>Plan approved</dt>
            <dd>{formatDate(localDay(record.approvedAt))}</dd>
          </div>
          <div>
            <dt>First reminder</dt>
            <dd>{formatDate(record.startDate!)}</dd>
          </div>
        </dl>
      </section>

      <h3 className="section-title">Your maintenance tasks</h3>
      <ul className="summary-list" aria-label="Accepted tasks">
        {accepted.map((task) => (
          <li key={task.id} className="summary-item aster-glass">
            <h3>{task.name}</h3>
            <dl>
              <div>
                <dt>How often</dt>
                <dd>{formatInterval(task.interval)}</dd>
              </div>
              <div>
                <dt>Google Calendar</dt>
                <dd>{task.calendarEventId ? 'Added' : 'Not added yet'}</dd>
              </div>
            </dl>
            <EvidenceBadge level={task.evidenceLevel} />
            <details>
              <summary>Instructions and source</summary>
              <p className="plan-card-description">{task.instructions}</p>
              <SourceDetails task={task} />
            </details>
          </li>
        ))}
      </ul>

      {rejected.length > 0 && (
        <p className="skipped-note">
          <span className="aster-eyebrow">Rejected</span> {rejected.map((t) => t.name).join(', ')}
        </p>
      )}

      {pending.length > 0 && (
        <>
          <CalendarReturnNotice />
          <CalendarPanel calendar={calendar} returnTo={`/appliances/${applianceId}`} storageKind={storageKind} />
          {calendar?.connected && (
            <button type="button" className="aster-btn aster-btn--primary full-width" disabled={busy} onClick={addMissing}>
              {busy ? 'Adding…' : `Add ${pending.length} ${pending.length === 1 ? 'task' : 'tasks'} to Google Calendar`}
            </button>
          )}
        </>
      )}

      {pending.length === 0 && accepted.length > 0 && (
        <section className="calendar-panel aster-inner" aria-label="Google Calendar">
          <p>Your tasks are in Google Calendar. Change, move or delete them there whenever you like.</p>
          <a className="aster-btn aster-btn--ghost full-width" href="https://calendar.google.com" target="_blank" rel="noreferrer">
            Open Google Calendar
          </a>
          {calendar?.connected && (
            <button
              type="button"
              className="link-button"
              onClick={async () => {
                if (await disconnectCalendar()) {
                  setCalendar((c) => (c ? { ...c, connected: false } : c))
                  setMessage('Google Calendar disconnected. Events already added stay in your calendar.')
                }
              }}
            >
              Disconnect Google Calendar from Keeply
            </button>
          )}
        </section>
      )}

      <DeleteAppliance applianceId={applianceId} name={applianceName(appliance)} hasCalendarEvents={accepted.some((t) => t.calendarEventId)} />
    </>
  )
}
