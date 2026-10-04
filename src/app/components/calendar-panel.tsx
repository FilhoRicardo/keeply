'use client'

import type { CalendarStatus } from '../lib/calendar-client'
import { connectUrl } from '../lib/calendar-client'

// Google Calendar connection state for a screen that writes approved tasks.
export function CalendarPanel({ calendar, returnTo, storageKind }: { calendar: CalendarStatus | null; returnTo: string; storageKind: string }) {
  return (
    <section className="calendar-panel aster-inner" aria-label="Google Calendar">
      {calendar === null && <p>Checking Google Calendar…</p>}
      {calendar?.connected && <p className="calendar-ok">Google Calendar connected.</p>}
      {calendar && !calendar.connected && calendar.configured && (
        <>
          <p>Connect Google Calendar so your accepted tasks can be added. Connecting adds nothing on its own.</p>
          <a className="aster-btn aster-btn--ghost full-width" href={connectUrl(returnTo)}>
            Connect Google Calendar
          </a>
        </>
      )}
      {calendar && !calendar.configured && (
        <p>{`Google Calendar is not set up on this server yet. Your approved plan will be saved${storageKind === 'device' ? ' on this device' : ''}.`}</p>
      )}
    </section>
  )
}
