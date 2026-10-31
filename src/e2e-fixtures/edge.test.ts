import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchDocument } from '@/search/fetch-document'
import { readCalendarEvents, resetCalendarEvents } from './calendar-log'
import { e2eManualResponse } from './documents'
import { fixtureResponse, withE2eFixtures } from './edge-fetch'
import { MANUAL_URL } from './fixtures'

afterEach(() => {
  resetCalendarEvents()
  vi.unstubAllEnvs()
})

describe('e2e network edge', () => {
  it('answers Brave, vision, and Calendar from fixtures and records only event writes', async () => {
    vi.stubEnv('KEEPLY_E2E_FIXTURES', '1')
    vi.stubEnv('VERCEL_ENV', '')

    const brave = fixtureResponse('https://api.search.brave.com/res/v1/web/search?q=Bosch')
    expect(brave).not.toBeNull()
    const braveBody = (await brave!.json()) as { web: { results: { url: string }[] } }
    expect(braveBody.web.results[0]?.url).toBe(MANUAL_URL)
    expect(readCalendarEvents()).toEqual([])

    const vision = fixtureResponse('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ messages: [{ content: [{ type: 'image_url' }, { type: 'text', text: 'Read this appliance label.' }] }] }),
    })
    const visionBody = (await vision!.json()) as { choices: { message: { content: string } }[] }
    expect(JSON.parse(visionBody.choices[0]!.message.content).model).toBe('SMS6ZCI49E')

    const token = fixtureResponse('https://oauth2.googleapis.com/token', { method: 'POST', body: 'grant_type=authorization_code' })
    expect(((await token!.json()) as { access_token: string }).access_token).toBe('e2e-calendar-token')
    expect(readCalendarEvents()).toEqual([])

    const created = fixtureResponse('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      body: JSON.stringify({ id: 'kp1', summary: 'Clean the filter · Bosch SMS6ZCI49E', recurrence: ['RRULE:FREQ=MONTHLY'] }),
    })
    expect(created?.status).toBe(200)
    expect(readCalendarEvents().map((event) => event.body.summary)).toEqual(['Clean the filter · Bosch SMS6ZCI49E'])
  })

  it('does not fake hosts when the flag is off or Vercel Production is set', async () => {
    const underlying = vi.fn(async () => new Response('live'))
    vi.stubEnv('KEEPLY_E2E_FIXTURES', '1')
    vi.stubEnv('VERCEL_ENV', 'production')
    const response = await withE2eFixtures(underlying)('https://api.search.brave.com/res/v1/web/search')
    expect(await response.text()).toBe('live')
    expect(underlying).toHaveBeenCalledOnce()
    expect(e2eManualResponse(MANUAL_URL)).toBeNull()

    vi.stubEnv('VERCEL_ENV', '')
    vi.stubEnv('KEEPLY_E2E_FIXTURES', '')
    expect(fixtureResponse('https://api.search.brave.com/res/v1/web/search')).toBeNull()
    expect(e2eManualResponse(MANUAL_URL)).toBeNull()

    vi.stubEnv('KEEPLY_E2E_FIXTURES', '1')
    expect(fixtureResponse('https://api.minimax.io/v1/chat/completions', { method: 'POST', body: '{}' })).toBeNull()
  })

  it('serves the manual through fetchDocument when the flag is on', async () => {
    vi.stubEnv('KEEPLY_E2E_FIXTURES', '1')
    vi.stubEnv('VERCEL_ENV', '')
    const result = await fetchDocument(MANUAL_URL, undefined, { timeoutMs: 1000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.type).toBe('html')
    expect(new TextDecoder().decode(result.bytes)).toContain('SMS6ZCI49E')
  })
})
