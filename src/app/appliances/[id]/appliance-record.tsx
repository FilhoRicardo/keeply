'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { applianceName } from '@/domain/calendar-event'
import { formatInterval } from '@/domain/format-interval'
import { isOverdue, nextDue } from '@/domain/schedule'
import { CalendarReturnNotice } from '../../components/calendar-return-notice'
import { CompletionForm } from '../../components/completion-form'
import { CustomiseForm } from '../../components/customise-form'
import { DeleteAppliance } from '../../components/delete-appliance'
import { EvidenceBadge } from '../../components/evidence-badge'
import { LoadingPanel, NotFoundPanel } from '../../components/screen'
import {
  connectUrl,
  disconnectCalendar,
  removeTaskEvents,
  fetchCalendarStatus,
  needsReschedule,
  pendingCalendarRemovals,
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
  const { state, addCompletion, recordCalendarResults, accessToken, updateTaskSchedule, setTaskPaused, clearCalendarEvents } =
    usePlan()
  const outcome = useSearchParams().get('approved')
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [completing, setCompleting] = useState<string | null>(null)

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
  const approved = record.tasks.filter((t) => t.status === 'approved' || t.status === 'paused')
  const pending = pendingCalendarTasks(record)
  const removals = pendingCalendarRemovals(record)

  // Removes paused tasks' events and forgets their ids; returns the task ids removed.
  async function removeFromCalendar(target: NonNullable<typeof record>, taskIds: readonly string[]): Promise<string[] | null> {
    const result = await removeTaskEvents(target, taskIds, await accessToken())
    if (result.kind === 'not_connected') setCalendar((c) => (c ? { ...c, connected: false } : c))
    if (result.kind !== 'removed') return null
    if (result.taskIds.length > 0) await clearCalendarEvents(applianceId, result.taskIds).catch(() => {})
    return result.taskIds
  }

  async function retry() {
    setBusy(true)
    try {
      const stale = removals.map((t) => t.id)
      const removed = stale.length > 0 ? await removeFromCalendar(record!, stale) : []
      const removedAll = removed !== null && stale.every((id) => removed.includes(id))
      if (pending.length === 0) {
        setMessage(removedAll ? 'Paused reminders removed from Google Calendar.' : 'Some reminders could not be removed. Try again later.')
        return
      }
      const result = await writeApprovedTasks(record!, await accessToken())
      if (result.kind === 'written') {
        await recordCalendarResults(applianceId, result.results)
        setMessage(
          result.results.every((r) => r.ok) && removedAll ? 'Added to Google Calendar.' : 'Some tasks still failed. Try again later.',
        )
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

  async function pause(taskId: string) {
    let state
    try {
      state = await setTaskPaused(applianceId, taskId, true)
    } catch {
      return
    }
    const next = findRecord(state, applianceId)!
    const task = next.tasks.find((t) => t.id === taskId)!
    if (!task.calendarEventId) return setMessage('Paused. Keeply will not remind you until you resume it.')
    if (!calendar?.connected) return setMessage('Paused. Connect Google Calendar to remove its reminder.')
    const removed = await removeFromCalendar(next, [taskId])
    if (removed?.includes(taskId)) {
      setMessage('Paused. Its reminder was removed from Google Calendar.')
    } else {
      setMessage('Paused, but its Google Calendar reminder could not be removed.')
    }
  }

  async function resume(taskId: string) {
    let state
    try {
      state = await setTaskPaused(applianceId, taskId, false)
    } catch {
      return
    }
    const next = findRecord(state, applianceId)!
    const task = next.tasks.find((t) => t.id === taskId)!
    if (!calendar?.connected) return setMessage('Resumed. Connect Google Calendar to add its reminder again.')
    const result = await writeTasks(next, [task], await accessToken())
    if (result.kind === 'written') await recordCalendarResults(applianceId, result.results).catch(() => {})
    setMessage(
      result.kind === 'written' && result.results.every((r) => r.ok)
        ? 'Resumed and back in Google Calendar.'
        : 'Resumed, but its Google Calendar reminder could not be added.',
    )
  }

  async function markDone(taskId: string, completedOn: string, notes: string | null) {
    let state
    try {
      state = await addCompletion(applianceId, taskId, completedOn, notes)
    } catch {
      return
    }
    setCompleting(null)
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
        {record.appliance.imageUrl && (
          // data: or short-lived signed URL of a private photo; next/image cannot optimise it.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="label-photo" src={record.appliance.imageUrl} alt={`Label photo of the ${applianceName(record.appliance)}`} />
        )}
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
                  {task.status === 'paused' ? (
                    <dd>Paused</dd>
                  ) : (
                    <dd className={isOverdue(due, now) ? 'overdue' : undefined}>
                      {formatDate(due)}
                      {isOverdue(due, now) && ' (overdue)'}
                    </dd>
                  )}
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
                  <span className="aster-eyebrow">Done</span>{' '}
                  {history.map((c) => formatDate(c.completedOn) + (c.notes ? ` (${c.notes})` : '')).join(', ')}
                </p>
              )}
              {completing === task.id ? (
                <CompletionForm
                  today={now}
                  onCancel={() => setCompleting(null)}
                  onSave={(completedOn, notes) => markDone(task.id, completedOn, notes)}
                />
              ) : editing === task.id ? (
                <CustomiseForm
                  initial={{ interval: task.userInterval, startDate: task.startDate, schedulingMode: task.schedulingMode }}
                  onCancel={() => setEditing(null)}
                  onSave={(schedule) => changeSchedule(task.id, schedule)}
                />
              ) : task.status === 'paused' ? (
                <button type="button" className="aster-btn aster-btn--ghost full-width" onClick={() => resume(task.id)}>
                  Resume
                </button>
              ) : (
                <>
                  <div className="button-row">
                    <button type="button" className="aster-btn aster-btn--ghost" onClick={() => setEditing(task.id)}>
                      Change schedule
                    </button>
                    <button type="button" className="aster-btn aster-btn--ghost" onClick={() => setCompleting(task.id)}>
                      Mark done
                    </button>
                  </div>
                  <button type="button" className="link-button" onClick={() => pause(task.id)}>
                    Pause reminders
                  </button>
                </>
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

      <CalendarReturnNotice />
      {(pending.length > 0 || removals.length > 0) && (
        <section className="calendar-panel aster-inner" aria-label="Google Calendar">
          {pending.length > 0 && (
            <p>
              {pending.length} approved {pending.length === 1 ? 'task is' : 'tasks are'} not in Google Calendar yet.
            </p>
          )}
          {removals.length > 0 && (
            <p>
              {removals.length} paused {removals.length === 1 ? 'task still has a reminder' : 'tasks still have reminders'} in Google
              Calendar.
            </p>
          )}
          {calendar?.connected ? (
            <button type="button" className="aster-btn aster-btn--primary full-width" disabled={busy} onClick={retry}>
              {pending.length > 0 ? 'Add to Google Calendar' : 'Remove from Google Calendar'}
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
      {calendar?.connected && (
        <p className="calendar-status">
          Google Calendar connected.{' '}
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
            Disconnect
          </button>
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
