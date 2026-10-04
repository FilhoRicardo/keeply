import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { POST } from '../api/calendar/events/route'
import { findRecord } from './plan-state'
import { createSupabasePlanRepository } from './supabase-plan-repository'
import { supabaseSink } from './track'

// Real supabase-js → PostgREST → Postgres with the Keeply migrations and RLS.
// Run via scripts/db-integration.sh, which provides these variables.
const { KEEPLY_POSTGREST_URL, KEEPLY_JWT_SECRET, KEEPLY_INTEGRATION_DB } = process.env
const OWNER = '00000000-0000-4000-8000-00000000000a'
const OTHER = '00000000-0000-4000-8000-00000000000b'

function jwt(sub: string) {
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 600 })}`
  return `${body}.${createHmac('sha256', KEEPLY_JWT_SECRET!).update(body).digest('base64url')}`
}

let proxy: Server
let supabaseUrl: string

// supabase-js calls <url>/rest/v1/…; plain PostgREST serves at the root.
beforeAll(async () => {
  execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-q', '-c', `insert into auth.users (id, email) values ('${OWNER}', 'a@example.com'), ('${OTHER}', 'b@example.com') on conflict do nothing`])
  const target = new URL(KEEPLY_POSTGREST_URL!)
  proxy = createServer((req, res) => {
    const upstream = request(
      { host: target.hostname, port: target.port, path: req.url!.replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers },
      (r) => {
        res.writeHead(r.statusCode!, r.headers)
        r.pipe(res)
      },
    )
    req.pipe(upstream)
  })
  await new Promise<void>((resolve) => proxy.listen(0, resolve))
  supabaseUrl = `http://localhost:${(proxy.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => proxy.close(() => resolve())))

function repoFor(user: string) {
  const db = createClient(supabaseUrl, jwt(user), { auth: { persistSession: false, autoRefreshToken: false } })
  return createSupabasePlanRepository({ db })
}

describe.skipIf(!KEEPLY_POSTGREST_URL)('Supabase plan repository', () => {
  it('runs the whole plan lifecycle under RLS', async () => {
    const repo = repoFor(OWNER)
    const { applianceId, state } = await repo.addAppliance({ manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' })
    const added = findRecord(state, applianceId)!
    expect(added.appliance).toMatchObject({ manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: null })
    expect(added.recommendations.map((r) => r.taskName)).toEqual([
      'Clean the filter',
      'Run a cleaning cycle',
      'Check the spray arms',
    ])
    expect(added.recommendations.every((r) => r.evidenceLevel === 'general_guidance')).toBe(true)

    const [filter, cycle, arms] = added.recommendations
    await repo.setDecision(applianceId, filter.id, { kind: 'include' })
    await repo.setDecision(applianceId, cycle.id, {
      kind: 'customise',
      interval: { count: 30, unit: 'day' },
      startDate: '2026-10-10',
      schedulingMode: 'completion_based',
    })
    await repo.setDecision(applianceId, arms.id, { kind: 'skip' })
    await repo.setDecision(applianceId, arms.id, null)
    const decided = await repo.setDecision(applianceId, arms.id, { kind: 'skip' })
    expect(findRecord(decided, applianceId)!.decisions[cycle.id]).toEqual({
      kind: 'customise',
      interval: { count: 30, unit: 'day' },
      startDate: '2026-10-10',
      schedulingMode: 'completion_based',
    })

    const approved = findRecord(await repo.approve(applianceId, '2026-10-05'), applianceId)!
    expect(approved.approvedAt).not.toBeNull()
    expect(approved.tasks.map((t) => [t.status, t.userInterval.count, t.schedulingMode])).toEqual([
      ['approved', 1, 'fixed_calendar'],
      ['approved', 30, 'completion_based'],
      ['skipped', 3, 'fixed_calendar'],
    ])
    expect(approved.recommendations[1].recommendedInterval).toEqual({ count: 1, unit: 'month' })

    await expect(repo.setDecision(applianceId, filter.id, { kind: 'skip' })).rejects.toThrow(/frozen/)
    await expect(repo.approve(applianceId, '2026-10-05')).rejects.toThrow(/already approved/)

    const [first, second, skipped] = approved.tasks
    const written = await repo.recordCalendarResults(applianceId, [
      { taskId: first.id, ok: true, eventId: 'evt-1' },
      { taskId: second.id, ok: false, error: 'boom' },
      { taskId: skipped.id, ok: true, eventId: 'evt-3' },
    ])
    expect(findRecord(written, applianceId)!.tasks.map((t) => t.calendarEventId)).toEqual(['evt-1', null, null])

    const rescheduled = await repo.updateTaskSchedule(applianceId, first.id, {
      interval: { count: 6, unit: 'week' },
      startDate: '2026-11-01',
      schedulingMode: 'fixed_calendar',
    })
    const moved = findRecord(rescheduled, applianceId)!
    expect(moved.tasks[0]).toMatchObject({ userInterval: { count: 6, unit: 'week' }, startDate: '2026-11-01', calendarEventId: 'evt-1' })
    expect(moved.recommendations[0].recommendedInterval).toEqual({ count: 1, unit: 'month' })
    await expect(repo.updateTaskSchedule(applianceId, skipped.id, { interval: { count: 1, unit: 'month' }, startDate: '2026-11-01', schedulingMode: 'fixed_calendar' })).rejects.toThrow(/approved/)

    const done = await repo.addCompletion(applianceId, second.id, '2026-10-12')
    expect(findRecord(done, applianceId)!.completions).toEqual([{ taskId: second.id, completedOn: '2026-10-12', notes: null }])
    await expect(repo.addCompletion(applianceId, skipped.id, '2026-10-12')).rejects.toThrow(/approved/)
  })

  it('keeps one owner’s plans invisible to another', async () => {
    const owner = repoFor(OWNER)
    const { applianceId } = await owner.addAppliance({ manufacturer: 'Miele', model: '', serialNumber: '' })
    const other = repoFor(OTHER)
    expect(findRecord(await other.load(), applianceId)).toBeUndefined()
    await expect(other.approve(applianceId, '2026-10-05')).rejects.toThrow(/Unknown appliance/)
    await expect(other.deleteAppliance(applianceId)).rejects.toThrow(/Unknown appliance/)
    expect(findRecord(await owner.load(), applianceId)).toBeDefined()
  })

  it('deletes an approved appliance with everything under it', async () => {
    const repo = repoFor(OWNER)
    const { applianceId, state } = await repo.addAppliance({ manufacturer: 'AEG', model: '', serialNumber: '' })
    for (const rec of findRecord(state, applianceId)!.recommendations) await repo.setDecision(applianceId, rec.id, { kind: 'include' })
    const approved = findRecord(await repo.approve(applianceId, '2026-10-05'), applianceId)!
    await repo.addCompletion(applianceId, approved.tasks[0].id, '2026-10-06')
    expect(findRecord(await repo.deleteAppliance(applianceId), applianceId)).toBeUndefined()
    const left = execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-tAc',
      `select (select count(*) from maintenance_recommendations where appliance_id = '${applianceId}') + (select count(*) from maintenance_tasks where appliance_id = '${applianceId}')`]).toString().trim()
    expect(left).toBe('0')
  })
})

describe.skipIf(!KEEPLY_POSTGREST_URL)('POST /api/calendar/events with Supabase', () => {
  async function approvedPlan() {
    const repo = repoFor(OWNER)
    const { applianceId, state } = await repo.addAppliance({ manufacturer: 'Bosch', model: '', serialNumber: '' })
    const [a, b, c] = findRecord(state, applianceId)!.recommendations
    await repo.setDecision(applianceId, a.id, { kind: 'include' })
    await repo.setDecision(applianceId, b.id, { kind: 'include' })
    await repo.setDecision(applianceId, c.id, { kind: 'skip' })
    return { applianceId, tasks: findRecord(await repo.approve(applianceId, '2026-10-05'), applianceId)!.tasks }
  }

  function call(user: string | null, body: unknown) {
    return POST(
      new NextRequest('http://keeply.local/api/calendar/events', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: 'keeply_gcal_token=google-token',
          ...(user ? { authorization: `Bearer ${jwt(user)}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    )
  }

  it('loads approved tasks under the caller’s session and never writes skipped ones', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl)
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-unused')
    const realFetch = globalThis.fetch
    const google: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      if (!url.startsWith('https://www.googleapis.com/')) return realFetch(input, init)
      google.push(JSON.parse(String(init?.body)).summary)
      return Response.json({ id: `evt-${google.length}` })
    })
    try {
      const { applianceId, tasks } = await approvedPlan()

      const response = await call(OWNER, { applianceId, taskIds: tasks.map((t) => t.id) })
      expect(response.status).toBe(200)
      const { results } = await response.json()
      expect(results.map((r: { taskId: string }) => r.taskId)).toEqual([tasks[0].id, tasks[1].id])
      expect(google).toEqual(['Clean the filter · Bosch dishwasher', 'Run a cleaning cycle · Bosch dishwasher'])

      expect((await call(OTHER, { applianceId, taskIds: [tasks[0].id] })).status).toBe(404)
      expect((await call(null, { applianceId, taskIds: [tasks[0].id] })).status).toBe(401)
      expect((await call(OWNER, { drafts: [] })).status).toBe(400)
      expect(google).toHaveLength(2)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})

describe.skipIf(!KEEPLY_POSTGREST_URL)('Supabase funnel sink', () => {
  it('appends events under the visitor’s own id', async () => {
    const db = createClient(supabaseUrl, jwt(OWNER), { auth: { persistSession: false, autoRefreshToken: false } })
    const sink = supabaseSink(db, async () => {})
    sink({ name: 'plan_approved', applianceId: '11111111-1111-4111-8111-111111111111', approved: 2, skipped: 1, at: new Date().toISOString() })
    sink({ name: 'calendar_connected', at: new Date().toISOString() })
    const count = () =>
      execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-tAc', `select count(*) from funnel_events where user_id = '${OWNER}'`]).toString().trim()
    for (let i = 0; i < 50 && count() !== '2'; i++) await new Promise((r) => setTimeout(r, 50))
    expect(count()).toBe('2')
    const props = execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-tAc', "select props from funnel_events where name = 'plan_approved'"]).toString().trim()
    expect(JSON.parse(props)).toEqual({ approved: 2, skipped: 1 })
  })
})
