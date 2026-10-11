import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Proves the preload wraps the same named imports the server uses, and that
// Vercel Production cannot turn the wrappers on. The Playwright spec then runs
// those wrappers through the real route handlers.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const preload = path.join(root, 'e2e', 'network-fixtures.cjs')
const journal = path.join(root, 'test-results', 'e2e-network', 'calendar.jsonl')

const PROBE = `
import { request } from 'node:https'
import { lookup } from 'node:dns/promises'
const addresses = await lookup('www.bosch-home.com', { all: true })
const read = (href) => new Promise((resolve, reject) => {
  const req = request(new URL(href), { method: 'GET' }, (res) => {
    const chunks = []
    res.on('data', (chunk) => chunks.push(chunk))
    res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks).toString('utf8') }))
  })
  req.on('error', reject)
  req.end()
})
const exact = await read('https://www.bosch-home.com/manuals/DI6012-1.html')
const other = await read('https://www.bosch-home.com/manuals/DI6012-2.html')
const vision = await (await fetch('https://openrouter.ai/api/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ content: [{ type: 'image_url' }] }] }),
})).json()
const extracted = await (await fetch('https://api.minimax.io/v1/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ messages: [{ content: '[Page 1]\\nClean the filter' }] }),
})).json()
const brave = await (await fetch('https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent('Bosch DI6012-9 user manual'))).json()
const token = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST' })).json()
const created = await (await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ id: 'kpabc', summary: 'Clean the filter · Bosch DI6012-1', recurrence: ['RRULE:FREQ=MONTHLY'] }),
})).json()
console.log(JSON.stringify({
  requestName: request.name,
  address: addresses[0].address,
  exactStatus: exact.status,
  exactType: exact.type,
  exactHasModel: exact.body.includes('DI6012-1'),
  exactHasQuote: exact.body.includes('Clean the filter once a month under running water.'),
  otherHasExactModel: /(?<![A-Za-z0-9])DI6012-1(?![A-Za-z0-9])/i.test(other.body),
  otherHasOwnModel: other.body.includes('DI6012-2'),
  visionModel: JSON.parse(vision.choices[0].message.content).model,
  visionEvidence: JSON.parse(vision.choices[0].message.content).typeEvidence,
  extractionTasks: JSON.parse(extracted.choices[0].message.content).candidates.map((item) => item.task),
  braveUrl: brave.web.results[0].url,
  tokenScope: token.scope,
  calendarId: created.id,
}))
`

function run(env: Record<string, string | undefined>, script = PROBE) {
  return spawnSync(process.execPath, ['--require', preload, '--input-type=module', '-e', script], {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
}

describe('e2e network fixtures', () => {
  afterAll(() => {
    rmSync(journal, { force: true })
  })

  it('answers manual download, vision, extraction, search and calendar without leaving the process', () => {
    rmSync(journal, { force: true })
    const result = run({ KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: '' })
    expect(result.stderr, result.stdout).toBe('')
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      requestName: 'patchedRequest',
      address: '1.1.1.1',
      exactStatus: 200,
      exactType: 'text/html; charset=utf-8',
      exactHasModel: true,
      exactHasQuote: true,
      otherHasExactModel: false,
      otherHasOwnModel: true,
      visionModel: 'DI6012-1',
      visionEvidence: 'Dishwasher',
      extractionTasks: ['Clean the filter', 'Descale the appliance', 'Check the spray arms'],
      braveUrl: 'https://www.bosch-home.com/manuals/DI6012-2.html',
      tokenScope: 'https://www.googleapis.com/auth/calendar.events',
      calendarId: 'kpabc',
    })
    const recorded = readFileSync(journal, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
    expect(recorded).toHaveLength(1)
    expect(recorded[0].body.summary).toBe('Clean the filter · Bosch DI6012-1')
    expect(recorded[0].method).toBe('POST')
  })

  it('does not install the wrappers in Vercel Production', () => {
    const result = run(
      { KEEPLY_E2E_FIXTURES: '1', VERCEL_ENV: 'production' },
      `import { request } from 'node:https'\nconsole.log(request.name)\n`,
    )
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('request')
  })

  it('does not install the wrappers when the flag is unset', () => {
    const result = run({ KEEPLY_E2E_FIXTURES: '', VERCEL_ENV: '' }, `import { request } from 'node:https'\nconsole.log(request.name)\n`)
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('request')
  })
})
