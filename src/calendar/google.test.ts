import { describe, expect, it, vi } from 'vitest'
import type { CalendarEventDraft } from '@/domain/calendar-event'
import {
  exchangeGoogleCode,
  GOOGLE_CALENDAR_SCOPE,
  googleAuthorizationUrl,
  googleCalendarWriter,
  googleEventId,
  googleOAuthConfig,
} from './google'
import { writeEvents, type CalendarWriter } from './writer'

const draft: CalendarEventDraft = {
  taskId: '4f1c2d3e-0000-4000-8000-000000000001',
  summary: 'Clean the filter · Bosch dishwasher',
  description: 'Rinse it',
  date: '2026-10-05',
  endDate: '2026-10-06',
  recurrence: ['RRULE:FREQ=MONTHLY'],
}

function respond(status: number, body: unknown = {}) {
  return vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }))
}

describe('googleEventId', () => {
  it('is deterministic and uses only base32hex characters', () => {
    const id = googleEventId(draft.taskId)
    expect(id).toBe(googleEventId(draft.taskId))
    expect(id).toMatch(/^[0-9a-v]{5,1024}$/)
    expect(id).not.toBe(googleEventId('another-task'))
  })
})

describe('googleCalendarWriter', () => {
  it('posts an all-day recurring event to the primary calendar', async () => {
    const fetchMock = respond(200, { id: 'evt-1' })
    const writer = googleCalendarWriter({ accessToken: 'token', fetch: fetchMock })

    await expect(writer.upsertEvent(draft)).resolves.toEqual({ eventId: 'evt-1' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' })
    expect(JSON.parse(init?.body as string)).toMatchObject({
      id: googleEventId(draft.taskId),
      start: { date: '2026-10-05' },
      end: { date: '2026-10-06' },
      recurrence: ['RRULE:FREQ=MONTHLY'],
      extendedProperties: { private: { keeplyTaskId: draft.taskId } },
    })
  })

  it('omits recurrence for a single event', async () => {
    const fetchMock = respond(200, { id: 'evt-1' })
    await googleCalendarWriter({ accessToken: 't', fetch: fetchMock }).upsertEvent({ ...draft, recurrence: [] })
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).not.toHaveProperty('recurrence')
  })

  it('updates the existing event on 409 so retries and reschedules never duplicate', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: googleEventId(draft.taskId) }), { status: 200 }))
    const writer = googleCalendarWriter({ accessToken: 't', fetch: fetchMock })

    await expect(writer.upsertEvent({ ...draft, date: '2026-11-05', endDate: '2026-11-06' })).resolves.toEqual({
      eventId: googleEventId(draft.taskId),
    })
    const [url, init] = fetchMock.mock.calls[1]
    expect(init?.method).toBe('PUT')
    expect(url).toBe(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId(draft.taskId)}`)
    expect(JSON.parse(init?.body as string)).toMatchObject({ start: { date: '2026-11-05' } })
  })

  it('surfaces a failed update', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('{}', { status: 409 }))
      .mockResolvedValueOnce(new Response('{}', { status: 403 }))
    await expect(googleCalendarWriter({ accessToken: 't', fetch: fetchMock }).upsertEvent(draft)).rejects.toMatchObject({
      status: 403,
    })
  })

  it('surfaces other failures with their status', async () => {
    const writer = googleCalendarWriter({ accessToken: 't', fetch: respond(401) })
    await expect(writer.upsertEvent(draft)).rejects.toMatchObject({ status: 401 })
  })
})

describe('deleteEvent', () => {
  it('deletes the Task’s own event id only', async () => {
    const fetchMock = respond(200)
    await googleCalendarWriter({ accessToken: 't', fetch: fetchMock }).deleteEvent(draft.taskId)
    const [url, init] = fetchMock.mock.calls[0]
    expect(init?.method).toBe('DELETE')
    expect(url).toBe(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${googleEventId(draft.taskId)}`)
  })

  it.each([404, 410])('treats %i as already removed', async (status) => {
    await expect(googleCalendarWriter({ accessToken: 't', fetch: respond(status) }).deleteEvent('t1')).resolves.toBeUndefined()
  })

  it('surfaces other failures', async () => {
    await expect(googleCalendarWriter({ accessToken: 't', fetch: respond(403) }).deleteEvent('t1')).rejects.toMatchObject({ status: 403 })
  })

  it('marks written events confirmed so a resumed task revives its event', async () => {
    const fetchMock = respond(200, { id: 'x' })
    await googleCalendarWriter({ accessToken: 't', fetch: fetchMock }).upsertEvent(draft)
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string).status).toBe('confirmed')
  })
})

describe('writeEvents', () => {
  it('keeps going after one failure and reports each task', async () => {
    const writer: CalendarWriter = {
      deleteEvent: vi.fn(),
      upsertEvent: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ eventId: 'evt-2' }),
    }
    const results = await writeEvents(writer, [draft, { ...draft, taskId: 't2' }])
    expect(results).toEqual([
      { taskId: draft.taskId, ok: false, error: 'boom' },
      { taskId: 't2', ok: true, eventId: 'evt-2' },
    ])
  })
})

describe('Google OAuth', () => {
  const config = { clientId: 'cid', clientSecret: 'secret', redirectUri: 'http://localhost:3000/auth/google/callback' }

  it('is unconfigured until all three variables are set', () => {
    expect(googleOAuthConfig({ GOOGLE_CLIENT_ID: 'cid' })).toBeNull()
    expect(
      googleOAuthConfig({ GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REDIRECT_URI: config.redirectUri }),
    ).toEqual(config)
  })

  it('asks only for the calendar.events scope and carries state', () => {
    const url = new URL(googleAuthorizationUrl(config, 'xyz'))
    expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPE)
    expect(url.searchParams.get('state')).toBe('xyz')
    expect(url.searchParams.get('access_type')).toBe('online')
  })

  it('exchanges a code for an access token', async () => {
    const fetchMock = respond(200, { access_token: 'at', expires_in: 3599, scope: GOOGLE_CALENDAR_SCOPE })
    await expect(exchangeGoogleCode(config, 'code', fetchMock)).resolves.toEqual({ accessToken: 'at', expiresIn: 3599 })
    expect(String(fetchMock.mock.calls[0][1]?.body)).toContain('grant_type=authorization_code')
  })

  it('rejects a token that lacks calendar access', async () => {
    const fetchMock = respond(200, { access_token: 'at', expires_in: 3599, scope: 'openid' })
    await expect(exchangeGoogleCode(config, 'code', fetchMock)).rejects.toThrow(/not granted/)
  })
})

describe('revokeGoogleToken', () => {
  it('posts the token to Google’s revoke endpoint', async () => {
    const fetchMock = respond(200)
    const { revokeGoogleToken } = await import('./google')
    await revokeGoogleToken('tok', fetchMock)
    expect(fetchMock.mock.calls[0][0]).toBe('https://oauth2.googleapis.com/revoke')
    expect(String(fetchMock.mock.calls[0][1]?.body)).toBe('token=tok')
  })
})
