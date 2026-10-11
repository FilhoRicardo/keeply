// node --require needs CommonJS so these wrappers exist before any ESM import of node:https.
/* eslint-disable @typescript-eslint/no-require-imports */

// Network-edge fakes for the full-journey e2e (RF-353).
//
// Loaded with `node --require` before Next starts, so named imports of
// `node:https` and `node:dns/promises` capture the wrappers. OpenRouter, MiniMax,
// Brave Search, Google's token endpoint and Google Calendar go through global
// fetch. Manual download uses node:https, not fetch, so that client is wrapped too.
//
// The flag matches src/e2e/fixtures-mode.ts: ignored when VERCEL_ENV=production.
// Without the flag this file does nothing, so a stray --require cannot turn the
// fakes on.

const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { Readable } = require('node:stream')
const https = require('node:https')
const dns = require('node:dns')

const FIXTURE_HOSTS = new Set(['www.bosch-home.com', 'bosch-home.com'])
const MANUAL_DIR = path.join(__dirname, 'fixtures', 'manuals')
const MANUALS = {
  'https://www.bosch-home.com/manuals/DI6012-1.html': 'di6012-1.html',
  'https://www.bosch-home.com/manuals/DI6012-2.html': 'di6012-2.html',
}

// A different confirmed model (DI6012-9, same family) is handed the other manual.
const OTHER_MODEL = 'DI6012-9'

const VISION_REPLY = {
  applianceType: 'dishwasher',
  // RF-350 keeps a category only when the reply quotes printed type text. Current
  // main ignores the extra field. Either way the owner is confirming a dishwasher.
  typeEvidence: 'Dishwasher',
  manufacturer: 'Bosch',
  model: 'DI6012-1',
  serialNumber: null,
  confidence: 0.91,
}

const EXTRACTION_REPLY = {
  candidates: [
    {
      task: 'Clean the filter',
      instructions: 'Twist out the filter, rinse it under warm running water, and refit it.',
      interval: { count: 1, unit: 'month' },
      page: 1,
      quote: 'Clean the filter once a month under running water.',
    },
    {
      task: 'Descale the appliance',
      instructions: 'Run a hot cycle with a suitable descaler.',
      interval: { count: 6, unit: 'month' },
      page: 1,
      quote: 'Descale the appliance every 6 months with a suitable descaler.',
    },
    {
      task: 'Check the spray arms',
      instructions: 'Clear blocked holes so the arms spin freely.',
      interval: { count: 3, unit: 'month' },
      page: 1,
      quote: 'Check the spray arms every 3 months and clear any blocked holes.',
    },
  ],
}

const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const JOURNAL_PATH = path.join(process.cwd(), 'test-results', 'e2e-network', 'calendar.jsonl')

function e2eFixturesEnabled(env = process.env) {
  if (env.VERCEL_ENV === 'production') return false
  return env.KEEPLY_E2E_FIXTURES === '1'
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function requestUrl(input) {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  if (input && typeof input === 'object' && typeof input.url === 'string') return input.url
  return ''
}

function manualHref(href) {
  try {
    const url = new URL(href)
    url.hash = ''
    url.search = ''
    return url.href
  } catch {
    return null
  }
}

function manualBytes(href) {
  const key = manualHref(href)
  const file = key ? MANUALS[key] : undefined
  if (!file) return null
  return fs.readFileSync(path.join(MANUAL_DIR, file))
}

function isFixtureHost(hostname) {
  return FIXTURE_HOSTS.has(String(hostname).replace(/^\[|\]$/g, '').toLowerCase())
}

function chatReply(init) {
  const raw = typeof init?.body === 'string' ? init.body : ''
  const reply = raw.includes('image_url') ? VISION_REPLY : EXTRACTION_REPLY
  return jsonResponse({ choices: [{ message: { content: JSON.stringify(reply) } }] })
}

function braveReply(href) {
  const query = new URL(href).searchParams.get('q') ?? ''
  const other = query.toUpperCase().includes(OTHER_MODEL)
  const model = other ? 'DI6012-2' : 'DI6012-1'
  const url = `https://www.bosch-home.com/manuals/${model}.html`
  return jsonResponse({
    web: {
      results: [
        {
          url,
          title: `Bosch ${model} user manual`,
          description: `Official user manual for Bosch dishwasher ${model}.`,
        },
      ],
    },
  })
}

function recordCalendar(method, href, body) {
  fs.mkdirSync(path.dirname(JOURNAL_PATH), { recursive: true })
  fs.appendFileSync(JOURNAL_PATH, `${JSON.stringify({ at: new Date().toISOString(), method, url: href, body })}\n`)
}

function calendarReply(href, init) {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (method === 'POST' || method === 'PUT') {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}')
    recordCalendar(method, href, body)
    return jsonResponse({ id: typeof body.id === 'string' ? body.id : 'e2e-event' })
  }
  return jsonResponse({})
}

async function patchedFetch(input, init) {
  const href = requestUrl(input)
  if (href.startsWith('https://openrouter.ai/') || href.startsWith('https://api.minimax.io/')) return chatReply(init)
  if (href.startsWith('https://api.search.brave.com/')) return braveReply(href)
  if (href.startsWith('https://oauth2.googleapis.com/token')) {
    return jsonResponse({ access_token: 'e2e-calendar-token', expires_in: 3600, scope: CALENDAR_SCOPE })
  }
  if (href.startsWith('https://oauth2.googleapis.com/revoke')) return new Response(null, { status: 200 })
  if (href.startsWith('https://www.googleapis.com/calendar/')) return calendarReply(href, init)
  return patchedFetch.original(input, init)
}

function httpsArgs(urlOrOptions, optionsOrCallback, maybeCallback) {
  let href = null
  let callback = maybeCallback
  if (typeof urlOrOptions === 'string' || urlOrOptions instanceof URL) {
    href = urlOrOptions instanceof URL ? urlOrOptions.href : urlOrOptions
    if (typeof optionsOrCallback === 'function') callback = optionsOrCallback
  } else if (urlOrOptions && typeof urlOrOptions === 'object') {
    if (typeof optionsOrCallback === 'function') callback = optionsOrCallback
    if (typeof urlOrOptions.href === 'string') href = urlOrOptions.href
  }
  return { href, callback }
}

function patchedRequest(urlOrOptions, optionsOrCallback, maybeCallback) {
  const { href, callback } = httpsArgs(urlOrOptions, optionsOrCallback, maybeCallback)
  const bytes = href ? manualBytes(href) : null
  if (!bytes) return patchedRequest.original.apply(this, arguments)
  const req = new EventEmitter()
  req.end = () => {
    const res = Readable.from([bytes])
    res.statusCode = 200
    res.headers = {
      'content-type': 'text/html; charset=utf-8',
      'content-length': String(bytes.length),
    }
    process.nextTick(() => {
      if (typeof callback === 'function') callback(res)
    })
  }
  return req
}

function patchedLookup(hostname, options) {
  if (isFixtureHost(hostname)) {
    const answer = { address: '1.1.1.1', family: 4 }
    return Promise.resolve(options && options.all ? [answer] : answer)
  }
  return patchedLookup.original(hostname, options)
}

function installE2eNetworkFixtures(env = process.env) {
  if (!e2eFixturesEnabled(env)) return false
  if (global.__keeplyE2eFixturesInstalled) return true

  patchedFetch.original = global.fetch
  global.fetch = patchedFetch

  patchedRequest.original = https.request
  https.request = patchedRequest

  patchedLookup.original = dns.promises.lookup
  dns.promises.lookup = patchedLookup

  global.__keeplyE2eFixturesInstalled = true
  return true
}

if (e2eFixturesEnabled()) installE2eNetworkFixtures()

module.exports = {
  CALENDAR_SCOPE,
  JOURNAL_PATH,
  e2eFixturesEnabled,
  installE2eNetworkFixtures,
}
