import type { CalendarEventDraft } from '@/domain/calendar-event'
import type { CalendarWriter } from './writer'

const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars'
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'

// Narrowest scope that lets us create events. We never read the user's calendar.
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

type Fetch = typeof fetch

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'GoogleCalendarError'
  }
}

// Google event ids use base32hex (0-9, a-v), 5–1024 chars. A deterministic id per Task makes
// writes idempotent: a second insert returns 409 and becomes an update instead of a duplicate.
export function googleEventId(taskId: string): string {
  const encoded = Array.from(new TextEncoder().encode(taskId), (b) => b.toString(16).padStart(2, '0')).join('')
  return `kp${encoded}`
}

export function googleEventBody(draft: CalendarEventDraft) {
  return {
    id: googleEventId(draft.taskId),
    summary: draft.summary,
    description: draft.description,
    start: { date: draft.date },
    end: { date: draft.endDate },
    ...(draft.recurrence.length > 0 ? { recurrence: draft.recurrence } : {}),
    transparency: 'transparent',
    reminders: { useDefault: true },
    extendedProperties: { private: { keeplyTaskId: draft.taskId } },
  }
}

export function googleCalendarWriter({
  accessToken,
  calendarId = 'primary',
  fetch: fetchImpl = fetch,
}: {
  accessToken: string
  calendarId?: string
  fetch?: Fetch
}): CalendarWriter {
  const eventsUrl = `${EVENTS_URL}/${encodeURIComponent(calendarId)}/events`
  const send = (method: 'POST' | 'PUT', url: string, body: unknown) =>
    fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const fail = (status: number): never => {
    throw new GoogleCalendarError(`Google Calendar rejected the event (${status})`, status)
  }

  return {
    async upsertEvent(draft) {
      const body = googleEventBody(draft)
      let response = await send('POST', eventsUrl, body)
      // The Task already has an event: update it in place (retry, or a new due date).
      if (response.status === 409) response = await send('PUT', `${eventsUrl}/${body.id}`, body)
      if (!response.ok) fail(response.status)
      const saved = (await response.json()) as { id?: string }
      return { eventId: saved.id ?? body.id }
    },
  }
}

export type GoogleOAuthConfig = { clientId: string; clientSecret: string; redirectUri: string }

export function googleOAuthConfig(env: Record<string, string | undefined> = process.env): GoogleOAuthConfig | null {
  const { GOOGLE_CLIENT_ID: clientId, GOOGLE_CLIENT_SECRET: clientSecret, GOOGLE_REDIRECT_URI: redirectUri } = env
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null
}

export function googleAuthorizationUrl(config: Pick<GoogleOAuthConfig, 'clientId' | 'redirectUri'>, state: string): string {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: GOOGLE_CALENDAR_SCOPE,
    // Online access: we write at approval time only and never store a refresh token.
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: 'consent',
    state,
  })
  return `${AUTH_URL}?${params}`
}

export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  fetchImpl: Fetch = fetch,
): Promise<{ accessToken: string; expiresIn: number }> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!response.ok) throw new GoogleCalendarError(`Google sign-in failed (${response.status})`, response.status)
  const token = (await response.json()) as { access_token: string; expires_in: number; scope?: string }
  if (token.scope && !token.scope.split(' ').includes(GOOGLE_CALENDAR_SCOPE)) {
    throw new GoogleCalendarError('Calendar access was not granted', 403)
  }
  return { accessToken: token.access_token, expiresIn: token.expires_in }
}
