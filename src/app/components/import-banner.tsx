'use client'

import { useState } from 'react'
import { usePlan } from '../lib/plan-context'

// Offers to move plans saved only on this device into the Keeply account. Never discards them.
export function ImportBanner() {
  const { pendingImport, importDevicePlan } = usePlan()
  const [hidden, setHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  if (pendingImport === 0 || hidden) return null

  return (
    <section className="calendar-panel aster-inner import-banner" aria-label="Plans on this device">
      <p>
        {pendingImport === 1 ? 'A dishwasher is' : `${pendingImport} dishwashers are`} saved only on this device. Move{' '}
        {pendingImport === 1 ? 'it' : 'them'} to your Keeply account so {pendingImport === 1 ? 'it is' : 'they are'} kept
        safe.
      </p>
      <div className="button-row">
        <button type="button" className="aster-btn aster-btn--ghost" onClick={() => setHidden(true)} disabled={busy}>
          Not now
        </button>
        <button
          type="button"
          className="aster-btn aster-btn--primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await importDevicePlan().catch(() => {})
            setBusy(false)
          }}
        >
          {busy ? 'Moving…' : 'Move to my account'}
        </button>
      </div>
    </section>
  )
}
