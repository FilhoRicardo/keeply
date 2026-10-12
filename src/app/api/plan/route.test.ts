import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

// KEE-42 route gate: body-validation, content-type, same-origin, gate, and 200 paths all run
// without a real Brave call, a real MiniMax call, or a real Supabase DB. The handler is exercised
// with vi.mocked internals so the test can run anywhere.

const mockRunPlan = vi.fn()
const mockRecordPlanSearch = vi.fn()
const mockPlanSearchLive = vi.fn()
const mockCreateServiceRoleDb = vi.fn()
const mockBraveQuotaStatus = vi.fn()

vi.mock('./orchestration', () => ({
  planSearchLive: (...args: unknown[]) => mockPlanSearchLive(...args),
  runPlan: (...args: unknown[]) => mockRunPlan(...args),
  recordPlanSearch: (...args: unknown[]) => mockRecordPlanSearch(...args),
}))

const admitScanMock = vi.fn()
vi.mock('../../lib/scan-gate', () => ({ admitScan: (...args: unknown[]) => admitScanMock(...args) }))

vi.mock('@/db/brave-quota', () => ({
  createServiceRoleDb: (...args: unknown[]) => mockCreateServiceRoleDb(...args),
  braveQuotaStatus: (...args: unknown[]) => mockBraveQuotaStatus(...args),
}))

import { POST, GET } from './route'

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new NextRequest('http://keeply.local/api/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://keeply.local', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  mockRunPlan.mockReset()
  mockRecordPlanSearch.mockReset()
  mockPlanSearchLive.mockReset()
  admitScanMock.mockReset()
  mockCreateServiceRoleDb.mockReset()
  mockBraveQuotaStatus.mockReset()
})

describe('POST /api/plan', () => {
  it('returns 404 when nothing is configured (Manual mode without a Brave key)', async () => {
    mockPlanSearchLive.mockReturnValueOnce(false)
    const response = await post({ manufacturer: 'Bosch', model: 'X' })
    expect(response.status).toBe(404)
    expect(mockRunPlan).not.toHaveBeenCalled()
  })

  it('rejects a non-JSON content type with 415', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    const response = await POST(
      new NextRequest('http://keeply.local/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'text/plain', origin: 'http://keeply.local' },
        body: 'manufacturer=Bosch&model=X',
      }),
    )
    expect(response.status).toBe(415)
  })

  it('rejects a cross-origin POST with 403', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    const response = await POST(
      new NextRequest('http://keeply.local/api/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: JSON.stringify({ manufacturer: 'Bosch', model: 'X' }),
      }),
    )
    expect(response.status).toBe(403)
  })

  it('refuses a billable call without a session (Brave key + no Authorization)', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'server-key')
    const response = await post({ manufacturer: 'Bosch', model: 'X' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'plan_denied', reason: 'signed_out' })
    expect(mockRunPlan).not.toHaveBeenCalled()
  })

  it('still refuses an unsigned Brave search in production when the e2e fixture flag is set', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'server-key')
    vi.stubEnv('KEEPLY_E2E_FIXTURES', '1')
    vi.stubEnv('VERCEL_ENV', 'production')
    const response = await post({ manufacturer: 'Bosch', model: 'X' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'plan_denied', reason: 'signed_out' })
    expect(admitScanMock).not.toHaveBeenCalled()
    expect(mockRunPlan).not.toHaveBeenCalled()
  })

  it('lets the fixture e2e reach admitScan without a Supabase session', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    vi.stubEnv('BRAVE_SEARCH_API_KEY', 'server-key')
    vi.stubEnv('KEEPLY_E2E_FIXTURES', '1')
    vi.stubEnv('VERCEL_ENV', '')
    admitScanMock.mockResolvedValueOnce('allowed')
    mockRunPlan.mockResolvedValueOnce({ proposals: [], fallback: 'general', searchOutcome: 'no_results', searchReason: null })
    const response = await post({ manufacturer: 'Bosch', model: 'SMS6ZCI49E' })
    expect(response.status).toBe(200)
    expect(admitScanMock).toHaveBeenCalledOnce()
    expect(mockRunPlan).toHaveBeenCalledOnce()
  })

  it('refuses when the caller has no remaining scan quota', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    admitScanMock.mockResolvedValueOnce('daily_limit')
    const response = await post({ manufacturer: 'Bosch', model: 'X' }, { authorization: 'Bearer user-session-token' })
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'plan_denied', reason: 'daily_limit' })
    expect(mockRunPlan).not.toHaveBeenCalled()
  })

  it('returns 400 for an invalid body', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    admitScanMock.mockResolvedValueOnce('allowed')
    const response = await post({ manufacturer: '', model: 'X' })
    expect(response.status).toBe(400)
  })

  it('rejects an empty model before reserving a scan', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    admitScanMock.mockResolvedValueOnce('allowed')
    const response = await post({ manufacturer: 'Bosch', model: '' }, { authorization: 'Bearer user-session-token' })
    expect(response.status).toBe(400)
    expect(admitScanMock).not.toHaveBeenCalled()
    expect(mockRunPlan).not.toHaveBeenCalled()
  })

  it('runs the plan and records the funnel event on success', async () => {
    mockPlanSearchLive.mockReturnValueOnce(true)
    admitScanMock.mockResolvedValueOnce('allowed')
    mockRunPlan.mockResolvedValueOnce({
      proposals: [],
      fallback: 'general',
      searchOutcome: 'no_results',
    })
    const response = await post({ manufacturer: 'Bosch', model: 'SMS6' }, { authorization: 'Bearer user-session-token' })
    expect(response.status).toBe(200)
    expect(mockRunPlan).toHaveBeenCalledWith({ manufacturer: 'Bosch', model: 'SMS6', modelFamily: undefined, applianceType: 'unknown' })
    expect(mockRecordPlanSearch).toHaveBeenCalledWith('no_results')
  })

  it('runs even when searchManuals is unavailable (general guidance path)', async () => {
    // The orchestration handles no_key by returning general guidance. The route is permitted
    // because planSearchLive returned true; the orchestrator then never issues a fetch.
    mockPlanSearchLive.mockReturnValueOnce(true)
    admitScanMock.mockResolvedValueOnce('allowed')
    mockRunPlan.mockResolvedValueOnce({
      proposals: [{ name: 'X', instructions: 'Y', interval: { count: 1, unit: 'month' }, evidenceLevel: 'general_guidance', source: { type: 'general_guidance', title: 't', url: null, location: null, quote: null } }],
      fallback: 'general',
      searchOutcome: 'no_results',
    })
    const response = await post({ manufacturer: 'Bosch', model: 'SMS6' }, { authorization: 'Bearer user-session-token' })
    expect(response.status).toBe(200)
    expect(mockRecordPlanSearch).toHaveBeenCalledWith('no_results')
  })
})

describe('GET /api/plan', () => {
  it('returns 503 when no service-role client is configured', async () => {
    const response = await GET()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'not_configured' })
  })

  it('returns the durable quota counter for the CFO daily report when Supabase is configured', async () => {
    const fakeDb = {} as Parameters<typeof mockBraveQuotaStatus>[0]
    mockCreateServiceRoleDb.mockReturnValueOnce(fakeDb)
    mockBraveQuotaStatus.mockResolvedValueOnce({ status: 'ok', used: 1, cap: 2000, monthStart: '2026-10-01' })
    const response = await GET()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok', used: 1, cap: 2000, monthStart: '2026-10-01' })
  })
})