import { NextResponse, type NextRequest } from 'next/server'
import { planSearchLive, recordPlanSearch, runPlan, type PlanResponse } from './orchestration'
import { admitScan } from '../../lib/scan-gate'
import { bearerToken, enforceJsonContentType, enforceSameOrigin } from '../../lib/calendar-session'
import { createServiceRoleDb, braveQuotaStatus } from '@/db/brave-quota'

// The plan-finding API route (KEE-42, P3-5). Body: { manufacturer, model, modelFamily? }. Returns
// { proposals, fallback, searchOutcome } where `fallback` is the level of the best proposal in the
// plan. Behind the same gate as /api/identify: scan on, billable provider or Brave key, the
// invite/limit reservation, and the durable Brave quota counter (checked before searchManuals).

// Brave search + AI extraction may take up to the per-step timeouts (~25 s). Vercel's free tier
// functions allow 30 s; give the function a little room.
export const maxDuration = 30

const MANUFACTURER = /^[A-Za-z0-9 .,'&/+-]{1,80}$/
const MODEL = /^[A-Za-z0-9 .,'&/+()-]{1,40}$/

type PlanBody = { manufacturer?: unknown; model?: unknown; modelFamily?: unknown }

function parseBody(body: unknown): { manufacturer: string; model: string; modelFamily?: string } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as PlanBody
  if (typeof b.manufacturer !== 'string' || !MANUFACTURER.test(b.manufacturer.trim())) return null
  if (typeof b.model !== 'string' || !MODEL.test(b.model.trim())) return null
  if (b.modelFamily !== undefined && (typeof b.modelFamily !== 'string' || !MODEL.test(b.modelFamily.trim()))) return null
  return {
    manufacturer: b.manufacturer.trim(),
    model: b.model.trim(),
    modelFamily: typeof b.modelFamily === 'string' ? b.modelFamily.trim() : undefined,
  }
}

// Who may use the plan route. The same invite/limit gate as /api/identify, only enabled when the
// plan search is "live" (a Brave key or a non-Manual AI provider). The /api/plan route never
// returns a calendar event — it only proposes tasks — but it costs a billable provider call, so
// the gate is right.
async function gate(request: NextRequest, env: Record<string, string | undefined>): Promise<NextResponse | null> {
  if (!planSearchLive(env)) return NextResponse.json({ error: 'not_enabled' }, { status: 404 })
  // No reservation needed when no provider call would happen (Manual mode with no Brave key).
  // planSearchLive already covered that case.
  if (!bearerToken(request.headers.get('authorization'))) {
    // The visitor must be signed in (anonymous or full) to spend a tester slot. Without a session
    // we refuse before any provider call; Manual without a session is still allowed.
    if (!env.BRAVE_SEARCH_API_KEY?.trim()) return null
    return NextResponse.json({ error: 'plan_denied', reason: 'signed_out' }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  const decision = await admitScan(request, env)
  if (decision !== 'allowed') {
    return NextResponse.json({ error: 'plan_denied', reason: decision }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  return null
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originGuard = enforceSameOrigin(request)
  if (originGuard) return originGuard
  const contentTypeGuard = enforceJsonContentType(request)
  if (contentTypeGuard) return contentTypeGuard
  const gated = await gate(request, process.env)
  if (gated) return gated
  const body = await request.json().catch(() => null)
  const parsed = parseBody(body)
  if (!parsed) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  const result = await runPlan(parsed)
  // Counts only — no document text, no URLs, no model name. The event is best-effort.
  await recordPlanSearch(result.searchOutcome)
  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
}

// CFO daily report. Service-role only. The dashboard will call this from the same operator
// environment that already has SUPABASE_SERVICE_ROLE_KEY.
export async function GET() {
  const db = createServiceRoleDb()
  if (!db) return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  const status = await braveQuotaStatus(db)
  return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } })
}

export type { PlanResponse }