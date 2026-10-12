import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createClient } from '@supabase/supabase-js'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import { planFallbackReason } from '../components/plan-fallback-banner'
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

const input = { manufacturer: 'Bosch', model: ' SMS6ZCI49E ', serialNumber: '' }

// Adds a dishwasher and decides its three general tasks: accept, accept, reject.
async function decidedPlan(user = OWNER) {
  const repo = repoFor(user)
  const { applianceId, state } = await repo.addAppliance(input, GENERAL_DISHWASHER_TASKS)
  const tasks = findRecord(state, applianceId)!.tasks
  await repo.decide(applianceId, tasks[0].id, 'accepted')
  await repo.decide(applianceId, tasks[1].id, 'accepted')
  await repo.decide(applianceId, tasks[2].id, 'rejected')
  return { repo, applianceId, tasks }
}

describe.skipIf(!KEEPLY_POSTGREST_URL)('Supabase plan repository', () => {
  it('runs the plan lifecycle under RLS', async () => {
    const { repo, applianceId, tasks } = await decidedPlan()
    const before = findRecord(await repo.load(), applianceId)!
    expect(before.appliance).toMatchObject({ manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: null })
    expect(before.tasks.map((t) => [t.name, t.status])).toEqual([
      ['Clean the filter', 'accepted'],
      ['Run a cleaning cycle', 'accepted'],
      ['Check the spray arms', 'rejected'],
    ])
    expect(before.tasks[0].source).toEqual(GENERAL_DISHWASHER_TASKS[0].source)

    const approved = findRecord(await repo.approve(applianceId, '2026-10-05'), applianceId)!
    expect(approved.startDate).toBe('2026-10-05')
    expect(approved.approvedAt).not.toBeNull()
    await expect(repo.decide(applianceId, tasks[2].id, 'accepted')).rejects.toThrow(/frozen/)
    await expect(repo.approve(applianceId, '2026-11-01')).rejects.toThrow(/already approved/)

    const written = await repo.recordCalendarResults(applianceId, [
      { taskId: tasks[0].id, ok: true, eventId: 'evt-1' },
      { taskId: tasks[2].id, ok: true, eventId: 'evt-rejected' },
    ])
    expect(findRecord(written, applianceId)!.tasks.map((t) => t.calendarEventId)).toEqual(['evt-1', null, null])
  })

  it('refuses to approve an undecided plan', async () => {
    const repo = repoFor(OWNER)
    const { applianceId } = await repo.addAppliance(input, GENERAL_DISHWASHER_TASKS)
    await expect(repo.approve(applianceId, '2026-10-05')).rejects.toThrow(/undecided/)
  })

  it('keeps one owner’s plans invisible to another', async () => {
    const { applianceId, tasks } = await decidedPlan()
    const other = repoFor(OTHER)
    expect(findRecord(await other.load(), applianceId)).toBeUndefined()
    await expect(other.decide(applianceId, tasks[0].id, 'rejected')).rejects.toThrow(/Unknown task/)
    await expect(other.deleteAppliance(applianceId)).rejects.toThrow(/Unknown appliance/)
  })

  it('stores Manufacturer verified only with its quote, and rejects it without one', async () => {
    const verified: TaskProposal = {
      name: 'Clean the filters',
      instructions: 'Check and clean the filters.',
      interval: { count: 1, unit: 'week' },
      evidenceLevel: 'manufacturer_verified',
      source: { type: 'manufacturer_manual', title: 'Manual', url: 'https://www.bosch-home.com/m.pdf', location: 'p. 32', quote: 'Clean the filters.' },
    }
    const repo = repoFor(OWNER)
    const { applianceId, state } = await repo.addAppliance(input, [verified])
    expect(findRecord(state, applianceId)!.tasks[0]).toMatchObject({ evidenceLevel: 'manufacturer_verified', source: verified.source })
    await expect(repo.addAppliance(input, [{ ...verified, source: { ...verified.source, quote: null } }])).rejects.toThrow(/evidence_supported/)
  })

  it.each([
    {
      name: 'verified',
      meta: { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true } satisfies ProposalMeta,
      proposals: [
        {
          name: 'Clean the filters',
          instructions: 'Check and clean the filters.',
          interval: { count: 1, unit: 'week' },
          evidenceLevel: 'manufacturer_verified',
          source: {
            type: 'manufacturer_manual',
            title: 'Manual',
            url: 'https://www.bosch-home.com/m.pdf',
            location: 'p. 32',
            quote: 'Clean the filters.',
          },
        },
      ] satisfies TaskProposal[],
      reason: 'no_search_key',
    },
    {
      name: 'similar-model',
      meta: { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true } satisfies ProposalMeta,
      proposals: [
        {
          name: 'Clean the filter',
          instructions: 'Rinse it.',
          interval: { count: 1, unit: 'month' },
          evidenceLevel: 'similar_model',
          source: {
            type: 'similar_model_manual',
            title: 'Smeg DI6012 series',
            url: 'https://www.smeg.com/di6012.pdf',
            location: 'page 18',
            quote: 'Clean the filter once a month.',
          },
        },
      ] satisfies TaskProposal[],
      reason: 'no_search_key',
    },
    {
      name: 'general-guidance',
      meta: { fallback: 'general', searchOutcome: 'no_results', searchReason: null, searched: true } satisfies ProposalMeta,
      proposals: GENERAL_DISHWASHER_TASKS,
      reason: 'no_results',
    },
    {
      name: 'extraction-unavailable',
      meta: { fallback: 'general', searchOutcome: 'extraction_unavailable', searchReason: null, searched: true } satisfies ProposalMeta,
      proposals: GENERAL_DISHWASHER_TASKS,
      reason: 'extraction_unavailable',
    },
    {
      name: 'timeout',
      meta: { fallback: 'general', searchOutcome: 'timeout', searchReason: null, searched: true } satisfies ProposalMeta,
      proposals: GENERAL_DISHWASHER_TASKS,
      reason: 'timeout',
    },
  ])('keeps the $name reason when a new repository reloads the plan', async ({ meta, proposals, reason }) => {
    const db = createClient(supabaseUrl, jwt(OWNER), { auth: { persistSession: false, autoRefreshToken: false } })
    const built = createSupabasePlanRepository({ db })
    const { applianceId } = await built.addAppliance(input, proposals, meta)
    const reloaded = createSupabasePlanRepository({ db })
    const record = findRecord(await reloaded.load(), applianceId)
    expect(record?.proposalMeta).toEqual(meta)
    expect(planFallbackReason(record?.proposalMeta ?? null)).toBe(reason)
  })

  it('loads an older appliance with no provenance as unknown', async () => {
    const repo = repoFor(OWNER)
    const { applianceId } = await repo.addAppliance(input, GENERAL_DISHWASHER_TASKS)
    const record = findRecord(await repoFor(OWNER).load(), applianceId)
    expect(record?.proposalMeta).toBeNull()
    expect(planFallbackReason(record?.proposalMeta ?? null)).toBe('no_proposal_meta')
  })

  it('deletes a dishwasher with its tasks', async () => {
    const { repo, applianceId } = await decidedPlan()
    await repo.deleteAppliance(applianceId)
    expect(findRecord(await repo.load(), applianceId)).toBeUndefined()
    const left = execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-tAc', `select count(*) from maintenance_tasks where appliance_id = '${applianceId}'`])
    expect(left.toString().trim()).toBe('0')
  })
})

describe.skipIf(!KEEPLY_POSTGREST_URL)('POST /api/calendar/events with Supabase', () => {
  function call(user: string | null, body: unknown) {
    return POST(
      new NextRequest('http://keeply.local/api/calendar/events', {
        method: 'POST',
        headers: {
          // KEE-49: same-origin guard runs before the token check, so integration
          // tests that POST same-origin must set Origin to match the request URL.
          origin: 'http://keeply.local',
          'content-type': 'application/json',
          cookie: 'keeply_gcal_token=google-token',
          ...(user ? { authorization: `Bearer ${jwt(user)}` } : {}),
        },
        body: JSON.stringify(body),
      }),
    )
  }

  it('loads the approved plan under the caller’s session and never writes rejected tasks', async () => {
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
      const { repo, applianceId, tasks } = await decidedPlan()
      const ids = tasks.map((t) => t.id)
      expect((await call(OWNER, { applianceId, taskIds: ids })).status).toBe(409)
      await repo.approve(applianceId, '2026-10-05')

      const response = await call(OWNER, { applianceId, taskIds: ids })
      expect(response.status).toBe(200)
      const { results } = await response.json()
      expect(results.map((r: { taskId: string }) => r.taskId)).toEqual([ids[0], ids[1]])
      // KEE-60: applianceName no longer appends " dishwasher" — the calendar event summary is
      // just "Clean the filter · Bosch SMS6ZCI49E" because Keeply is no longer dishwasher-only.
      expect(google).toEqual(['Clean the filter · Bosch SMS6ZCI49E', 'Run a cleaning cycle · Bosch SMS6ZCI49E'])

      expect((await call(OTHER, { applianceId, taskIds: [ids[0]] })).status).toBe(404)
      expect((await call(null, { applianceId, taskIds: [ids[0]] })).status).toBe(401)
      expect((await call(OWNER, { drafts: [] })).status).toBe(400)
      expect(google).toHaveLength(2)
    } finally {
      vi.unstubAllGlobals()
      vi.unstubAllEnvs()
    }
  })
})

describe.skipIf(!KEEPLY_POSTGREST_URL)('Supabase usage sink', () => {
  it('appends events under the visitor’s own id', async () => {
    const db = createClient(supabaseUrl, jwt(OTHER), { auth: { persistSession: false, autoRefreshToken: false } })
    const sink = supabaseSink(db, async () => {})
    sink({ name: 'plan_approved', accepted: 2, rejected: 1 })
    sink({ name: 'calendar_connected' })
    const count = () =>
      execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-tAc', `select count(*) from funnel_events where user_id = '${OTHER}'`]).toString().trim()
    for (let i = 0; i < 50 && count() !== '2'; i++) await new Promise((r) => setTimeout(r, 50))
    expect(count()).toBe('2')
    const props = execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-tAc', `select props from funnel_events where name = 'plan_approved' and user_id = '${OTHER}'`])
    expect(JSON.parse(props.toString().trim())).toEqual({ accepted: 2, rejected: 1 })
  })
})

describe.skipIf(!KEEPLY_POSTGREST_URL)('Scan invites and limits under concurrency', () => {
  const psql = (sql: string) => execFileSync('psql', [KEEPLY_INTEGRATION_DB!, '-tAc', sql]).toString().trim()
  const dbFor = (user: string) => createClient(supabaseUrl, jwt(user), { auth: { persistSession: false, autoRefreshToken: false } })
  // Leaves the database as it found it, so the test can be rerun the same day.
  const reset = () =>
    psql(
      'delete from public.scan_usage; delete from public.scan_daily_totals; ' +
        'delete from public.scan_invites; update public.scan_limits set per_tester_daily = 5, global_daily = 100',
    )

  it('holds the per-tester and daily limits exactly when scans arrive at once', async () => {
    const { reserveScan, redeemInvite, scanAllowance } = await import('@/db/scan-access')
    reset()
    try {
      psql('update public.scan_limits set per_tester_daily = 5, global_daily = 7')
      const [codeA, codeB] = [psql("select public.create_scan_invite('Tester A')"), psql("select public.create_scan_invite('Tester B')")]

      const a = dbFor(OWNER)
      const b = dbFor(OTHER)
      expect(await reserveScan(a)).toBe('no_invite')
      expect(await redeemInvite(a, codeA.toLowerCase())).toBe('invited')
      expect(await redeemInvite(b, codeA)).toBe('invalid')
      expect(await redeemInvite(b, codeB)).toBe('invited')

      const burst = async (db: ReturnType<typeof dbFor>) => Promise.all(Array.from({ length: 12 }, () => reserveScan(db)))
      const first = await burst(a)
      expect(first.filter((r) => r === 'allowed')).toHaveLength(5)
      expect(first.filter((r) => r === 'tester_limit')).toHaveLength(7)

      const second = await burst(b)
      expect(second.filter((r) => r === 'allowed')).toHaveLength(2)
      expect(second.filter((r) => r === 'daily_limit')).toHaveLength(10)
      expect(psql('select scans from public.scan_daily_totals')).toBe('7')

      expect(await scanAllowance(b)).toEqual({ status: 'invited', testerLeft: 3, globalLeft: 0 })
    } finally {
      reset()
    }
  })
})
