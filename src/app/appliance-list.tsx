'use client'

import Link from 'next/link'
import { applianceName } from '@/domain/calendar-event'
import { compareDates } from '@/domain/dates'
import { isOverdue, nextDue } from '@/domain/schedule'
import { formatDate } from './lib/format-date'
import { usePlan } from './lib/plan-context'
import type { ApplianceRecord } from './lib/plan-state'
import { today } from './lib/today'

function DishwasherIcon() {
  return (
    <span className="appliance-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="img">
        <rect x="5" y="2.75" width="14" height="18.5" rx="2" />
        <path d="M5 8h14M8 5.5h.01M11 5.5h5M8.5 12.25a4.5 4.5 0 1 0 7 0" />
      </svg>
    </span>
  )
}

// The soonest approved task, for the Home summary line.
export function soonestTask(record: ApplianceRecord) {
  const recs = new Map(record.recommendations.map((r) => [r.id, r]))
  return record.tasks
    .filter((t) => t.status === 'approved')
    .map((t) => ({ name: recs.get(t.recommendationId)?.taskName ?? 'Task', due: nextDue(t, record.completions) }))
    .sort((a, b) => compareDates(a.due, b.due))[0]
}

function summary(record: ApplianceRecord): string {
  if (!record.approvedAt) return 'Plan waiting for your review'
  const next = soonestTask(record)
  if (!next) return 'No active tasks'
  return isOverdue(next.due, today()) ? `${next.name} overdue since ${formatDate(next.due)}` : `Next: ${next.name}, ${formatDate(next.due)}`
}

export function ApplianceCount() {
  const { state } = usePlan()
  return (
    <span className="appliance-count" aria-hidden="true">
      {state?.records.length ?? 0}
    </span>
  )
}

export function ApplianceList() {
  const { state } = usePlan()
  if (!state) {
    return (
      <div className="empty-state aster-inner" aria-busy="true">
        <DishwasherIcon />
        <p>Loading your appliances…</p>
      </div>
    )
  }
  const records = state.records

  if (records.length === 0) {
    return (
      <div className="empty-state aster-inner">
        <DishwasherIcon />
        <div>
          <h3>No appliances yet.</h3>
          <p>Add your dishwasher to start building its maintenance plan.</p>
        </div>
      </div>
    )
  }

  return (
    <ul className="appliance-list">
      {records.map((record) => {
        const { appliance, approvedAt, tasks } = record
        const active = tasks.filter((t) => t.status === 'approved').length
        const href = approvedAt ? `/appliances/${appliance.id}` : `/appliances/${appliance.id}/plan`
        return (
          <li key={appliance.id}>
            <Link className="appliance-row aster-inner" href={href}>
              <DishwasherIcon />
              <span>
                <strong>{applianceName(appliance)}</strong>
                <small>
                  {approvedAt && `${active} active ${active === 1 ? 'task' : 'tasks'} · `}
                  {summary(record)}
                </small>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
