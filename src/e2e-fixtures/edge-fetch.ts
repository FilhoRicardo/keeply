import { recordCalendarEvent } from './calendar-log'
import { extractionReply, MANUAL_TITLE, MANUAL_URL, visionReply } from './fixtures'
import { e2eFixturesEnabled } from './guard'

const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

const FAKED_HOSTS = new Set([
  'openrouter.ai',
  'api.search.brave.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
])

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

function bodyText(init?: RequestInit): string {
  const body = init?.body
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  return ''
}

function chat(content: string): Response {
  return Response.json({ choices: [{ message: { content } }] })
}

// One outbound response for a host the e2e is allowed to fake. Null means "not our host"
// so ordinary server traffic still uses the network. A faked host never falls through:
// an unexpected path is a 404, which fails the journey instead of calling the real service.
export function fixtureResponse(input: RequestInfo | URL, init?: RequestInit): Response | null {
  if (!e2eFixturesEnabled()) return null
  let url: URL
  try {
    url = new URL(requestUrl(input))
  } catch {
    return null
  }
  const host = url.hostname.toLowerCase()
  if (!FAKED_HOSTS.has(host)) return null
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const body = bodyText(init)

  if (host === 'openrouter.ai') {
    if (!url.pathname.endsWith('/chat/completions')) return new Response('e2e fixture: unhandled', { status: 404 })
    const vision = body.includes('image_url') || body.includes('Read this appliance label')
    const content = vision ? JSON.stringify(visionReply()) : JSON.stringify(extractionReply())
    return chat(content)
  }

  if (host === 'api.search.brave.com') {
    if (!url.pathname.startsWith('/res/v1/web/search')) return new Response('e2e fixture: unhandled', { status: 404 })
    return Response.json({
      web: {
        results: [
          {
            url: MANUAL_URL,
            title: MANUAL_TITLE,
            description: 'Official Bosch dishwasher user manual.',
          },
        ],
      },
    })
  }

  if (host === 'oauth2.googleapis.com') {
    if (url.pathname === '/token') {
      return Response.json({
        access_token: 'e2e-calendar-token',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: GOOGLE_CALENDAR_SCOPE,
      })
    }
    if (url.pathname === '/revoke') return new Response(null, { status: 200 })
    return new Response('e2e fixture: unhandled', { status: 404 })
  }

  if (url.pathname.includes('/calendar/') && (method === 'POST' || method === 'PUT')) {
    let parsed: RecordedBody = {}
    try {
      parsed = JSON.parse(body) as RecordedBody
    } catch {
      parsed = {}
    }
    recordCalendarEvent({ method, url: url.href, body: parsed })
    return Response.json({ id: parsed.id ?? 'e2e-event' })
  }

  return new Response('e2e fixture: unhandled', { status: 404 })
}

type RecordedBody = {
  summary?: string
  description?: string
  recurrence?: string[]
  start?: { date?: string }
  end?: { date?: string }
  id?: string
}

// Wraps the fetch a provider already uses. When the flag is off this is that fetch.
// When the flag is on, a faked host is answered here and is not sent onward.
export function withE2eFixtures(fetchImpl: typeof fetch = fetch): typeof fetch {
  return (input, init) => {
    const fake = fixtureResponse(input, init)
    if (fake) return Promise.resolve(fake)
    return fetchImpl(input, init)
  }
}
