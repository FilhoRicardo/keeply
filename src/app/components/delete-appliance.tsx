'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { usePlan } from '../lib/plan-context'

// Two-step delete. Keeply never deletes calendar events: the owner stays in control of those.
export function DeleteAppliance({ applianceId, name, hasCalendarEvents }: { applianceId: string; name: string; hasCalendarEvents: boolean }) {
  const router = useRouter()
  const { deleteAppliance } = usePlan()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await deleteAppliance(applianceId)
      router.push('/')
    } catch {
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="link-button danger-link" onClick={() => setConfirming(true)}>
        Delete this dishwasher
      </button>
    )
  }

  return (
    <section className="calendar-panel aster-inner" aria-label="Delete dishwasher">
      <p>
        Delete <strong>{name}</strong>? Its plan and history are removed from Keeply.
        {hasCalendarEvents && ' Events already in Google Calendar stay there; remove them in Calendar if you want.'}
      </p>
      <div className="button-row">
        <button type="button" className="aster-btn aster-btn--ghost" onClick={() => setConfirming(false)} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="aster-btn aster-btn--danger" onClick={confirm} disabled={busy}>
          Delete
        </button>
      </div>
    </section>
  )
}
