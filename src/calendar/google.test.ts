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

    await expect(writer.createEvent(draft)).resolves.toEqual({ eventId: 'evt-1' })

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
    await googleCalendarWriter({ accessToken: 't', fetch: fetchMock }).createEvent({ ...draft, recurrence: [] })
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).not.toHaveProperty('recurrence')
  })

  it('treats 409 as already written so retries never duplicate', async () => {
    const writer = googleCalendarWriter({ accessToken: 't', fetch: respond(409) })
    await expect(writer.createEvent(draft)).resolves.toEqual({ eventId: googleEventId(draft.taskId) })
  })

  it('surfaces other failures with their status', async () => {
    const writer = googleCalendarWriter({ accessToken: 't', fetch: respond(401) })
    await expect(writer.createEvent(draft)).rejects.toMatchObject({ status: 401 })
  })
})

describe('writeEvents', () => {
  it('keeps going after one failure and reports each task', async () => {
    const writer: CalendarWriter = {
      createEvent: vi
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
