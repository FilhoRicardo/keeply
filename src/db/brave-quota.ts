import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Brave Search is paid out of a free quota (HANDOFF §23, CEO directive 2026-10-05). The per-process
// counter lives in src/search/brave.ts (P3-2). The durable counter lives in Postgres (this module),
// and the orchestration layer (src/app/lib/plan-orchestration.ts) checks it before any network IO so
// a refused call is never started. Counts only: no document text or URLs.

export type BraveReserveResult = 'allowed' | 'quota_exhausted'

export type BraveQuotaStatus = {
  status: 'ok' | 'quota_exhausted'
  used: number
  cap: number
  // First UTC day of the month the counter applies to (YYYY-MM-DD).
  monthStart: string
}

const RESERVE: readonly BraveReserveResult[] = ['allowed', 'quota_exhausted']

async function rpc(db: SupabaseClient, name: string): Promise<unknown> {
  const { data, error } = await db.rpc(name)
  if (error) throw new Error(`Supabase: ${error.message}`)
  return data
}

// Reads the current month status (cap, used, status) for the CFO daily report and the orchestration
// pre-check. Counts: no document text or URLs.
export async function braveQuotaStatus(db: SupabaseClient): Promise<BraveQuotaStatus> {
  const raw = (await rpc(db, 'brave_quota_status')) as { status?: string; used?: number; cap?: number; month_start?: string } | null
  const status = raw?.status === 'quota_exhausted' ? 'quota_exhausted' : 'ok'
  const used = Number(raw?.used ?? 0)
  const cap = Number(raw?.cap ?? 0)
  const monthStart = typeof raw?.month_start === 'string' ? raw.month_start : ''
  return { status, used, cap, monthStart }
}

// Reserves one Brave Search call for the caller, atomically. Returns 'allowed' and increments the
// durable counter, or 'quota_exhausted' without touching the search-manuals code path. The route
// calls this BEFORE searchManuals; once at the limit the Brave fetch is never made (KEE-42).
export async function reserveBraveSearch(db: SupabaseClient): Promise<BraveReserveResult> {
  const result = await rpc(db, 'reserve_brave_search')
  if (!RESERVE.includes(result as BraveReserveResult)) throw new Error(`Unexpected reserve_brave_search result: ${String(result)}`)
  return result as BraveReserveResult
}

// A service-role Supabase client from server env, or null when not configured. The CFO daily
// report and the orchestration's pre-check both go through here so they can be wired into the
// route handler with one construction site.
export function createServiceRoleDb(env: Record<string, string | undefined> = process.env): SupabaseClient | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) return null
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}