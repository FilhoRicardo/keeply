'use client'

import { useSearchParams } from 'next/navigation'

const COPY: Record<string, string> = {
  denied: 'Google Calendar was not connected, so nothing was added. You can connect again, or approve now and add tasks later.',
  error: 'Google sign-in did not finish. Nothing was added. Try connecting again.',
}

// Explains what happened when Google sends the owner back without calendar access.
export function CalendarReturnNotice() {
  const outcome = useSearchParams().get('calendar')
  const text = outcome ? COPY[outcome] : undefined
  if (!text) return null
  return (
    <p className="notice notice--warning" role="status">
      {text}
    </p>
  )
}
