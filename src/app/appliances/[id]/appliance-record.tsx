'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { applianceName } from '@/domain/calendar-event'
import { formatInterval } from '@/domain/format-interval'
import { isOverdue, nextDue } from '@/domain/schedule'
import { CustomiseForm } from '../../components/customise-form'
import { DeleteAppliance } from '../../components/delete-appliance'
import { EvidenceBadge } from '../../components/evidence-badge'
import { LoadingPanel, NotFoundPanel } from '../../components/screen'
import {
  connectUrl,
  fetchCalendarStatus,
  needsReschedule,
  pendingCalendarTasks,
  writeApprovedTasks,
  writeTasks,
  type CalendarStatus,
} from '../../lib/calendar-client'
import { usePlan } from '../../lib/plan-context'
import { findRecord } from '../../lib/plan-state'
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
  const { state, addCompletion, recordCalendarResults, accessToken, updateTaskSchedule } = usePlan()
  const outcome = useSearchParams().get('approved')
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)

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

  const now = today()
  const approved = record.tasks.filter((t) => t.status === 'approved')
  const pending = pendingCalendarTasks(record)

  async function retry() {
    setBusy(true)
    const result = await writeApprovedTasks(record!, await accessToken())
    if (result.kind === 'written') {
      await recordCalendarResults(applianceId, result.results)
      setMessage(result.results.every((r) => r.ok) ? 'Added to Google Calendar.' : 'Some tasks still failed. Try again later.')
    } else {
      setMessage(result.kind === 'not_connected' ? 'Connect Google Calendar first.' : 'Google Calendar could not be reached.')
      if (result.kind === 'not_connected') setCalendar((c) => (c ? { ...c, connected: false } : c))
    }
    setBusy(false)
  }

  async function changeSchedule(taskId: string, schedule: Parameters<typeof updateTaskSchedule>[2]) {
    let state
    try {
      state = await updateTaskSchedule(applianceId, taskId, schedule)
    } catch {
      return
    }
    setEditing(null)
    const next = findRecord(state, applianceId)!
    const task = next.tasks.find((t) => t.id === taskId)!
    if (!task.calendarEventId) return setMessage('Schedule updated.')
    if (!calendar?.connected) return setMessage('Schedule updated. Connect Google Calendar to update the reminder.')
    const result = await writeTasks(next, [task], await accessToken())
    setMessage(
      result.kind === 'written' && result.results.every((r) => r.ok)
        ? 'Schedule updated in Keeply and Google Calendar.'
        : 'Schedule updated, but the calendar reminder could not be changed.',
    )
  }

  async function markDone(taskId: string) {
    let state
    try {
      state = await addCompletion(applianceId, taskId, now)
    } catch {
      return
    }
    const next = findRecord(state, applianceId)!
    const task = next.tasks.find((t) => t.id === taskId)!
    if (!needsReschedule(task)) return
    const moved = formatDate(nextDue(task, next.completions))
    if (!calendar?.connected) {
      setMessage(`Next due ${moved}. Connect Google Calendar to move the reminder.`)
      return
    }
    const result = await writeTasks(next, [task], await accessToken())
    setMessage(
      result.kind === 'written' && result.results.every((r) => r.ok)
        ? `Reminder moved to ${moved}.`
        : `Next due ${moved}, but the calendar reminder could not be moved.`,
    )
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
              {editing === task.id ? (
                <CustomiseForm
                  initial={{ interval: task.userInterval, startDate: task.startDate, schedulingMode: task.schedulingMode }}
                  onCancel={() => setEditing(null)}
                  onSave={(schedule) => changeSchedule(task.id, schedule)}
                />
              ) : (
                <div className="button-row">
                  <button type="button" className="aster-btn aster-btn--ghost" onClick={() => setEditing(task.id)}>
                    Change schedule
                  </button>
                  <button type="button" className="aster-btn aster-btn--ghost" onClick={() => markDone(task.id)}>
                    Mark done today
                  </button>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <h2 className="section-title">Sources</h2>
      <ul className="summary-list" aria-label="Sources">
        {Array.from(new Map(record.recommendations.map((r) => [r.source.id, r])).values()).map((rec) => (
          <li key={rec.source.id} className="summary-item aster-inner">
            <h3>{rec.source.title}</h3>
            {rec.source.modelScope && <p className="history">Applies to: {rec.source.modelScope}</p>}
            <EvidenceBadge level={rec.evidenceLevel} explain />
            {rec.source.reference && (
              <a href={rec.source.reference} target="_blank" rel="noreferrer">
                Open source
              </a>
            )}
          </li>
        ))}
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
        </section>
      )}

      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}
      <DeleteAppliance
        applianceId={applianceId}
        name={applianceName(record.appliance)}
        hasCalendarEvents={record.tasks.some((t) => t.calendarEventId !== null)}
      />
    </>
  )
}
