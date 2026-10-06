'use client'

import Link from 'next/link'
import { applianceName } from '@/domain/calendar-event'
import { usePlan } from './lib/plan-context'
import type { ApplianceRecord } from '@/domain/model'

// KEE-60: the appliance glyph is appliance-agnostic (a generic box). Renamed from
// DishwasherIcon; the shape and the CSS class are unchanged.
function ApplianceIcon() {
  return (
    <span className="appliance-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" role="img">
        <rect x="5" y="2.75" width="14" height="18.5" rx="2" />
        <path d="M5 8h14M8 5.5h.01M11 5.5h5M8.5 12.25a4.5 4.5 0 1 0 7 0" />
      </svg>
    </span>
  )
}

export function summary(record: ApplianceRecord): string {
  if (!record.approvedAt) return 'Plan waiting for your review'
  const accepted = record.tasks.filter((t) => t.status === 'accepted')
  const added = accepted.filter((t) => t.calendarEventId).length
  const tasks = `${accepted.length} ${accepted.length === 1 ? 'task' : 'tasks'}`
  return added === accepted.length ? `${tasks} in Google Calendar` : `${tasks} approved · ${accepted.length - added} not in Google Calendar yet`
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
        <ApplianceIcon />
        <p>Loading your appliances…</p>
      </div>
    )
  }
  const records = state.records

  if (records.length === 0) {
    return (
      <div className="empty-state aster-inner">
        <ApplianceIcon />
        <div>
          <h3>No appliances yet.</h3>
          <p>Add your first appliance to start building its maintenance plan.</p>
        </div>
      </div>
    )
  }

  return (
    <ul className="appliance-list">
      {records.map((record) => {
        const { appliance, approvedAt } = record
        const href = approvedAt ? `/appliances/${appliance.id}` : `/appliances/${appliance.id}/plan`
        return (
          <li key={appliance.id}>
            <Link className="appliance-row aster-inner" href={href}>
              <ApplianceIcon />
              <span>
                <strong>{applianceName(appliance)}</strong>
                <small>{summary(record)}</small>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
