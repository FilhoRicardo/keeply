import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import { selectProvider } from '@/ai/provider'
import { reserveScan, type ReserveResult } from '@/db/scan-access'
import { scanEnabled } from './features'
import { bearerToken } from './calendar-session'

// Who may make a billable AI scan (docs/HANDOFF.md §23). Server only.
//
// KEEPLY_SCAN_ACCESS=invite (default): a Google sign-in, or an anonymous session with a live invite,
//   within the per-person and shared daily limits counted in Supabase. Fails closed: no Supabase,
//   no session or any error means no AI call.
// KEEPLY_SCAN_ACCESS=open: anyone who can reach the server. Only for a private machine or a
//   login-protected preview. Ignored in Vercel Production (VERCEL_ENV=production), so a preview
//   setting can never switch off the invite limits there.
export type ScanAccessMode = 'invite' | 'open'

export function scanAccessMode(env: Record<string, string | undefined> = process.env): ScanAccessMode {
  if (env.VERCEL_ENV === 'production') return 'invite'
  return env.KEEPLY_SCAN_ACCESS === 'open' ? 'open' : 'invite'
}

export type ScanDecision = ReserveResult | 'unavailable'

// Whether a photo would go to a billable AI provider at all (scanning on and a provider key set).
export function aiScanLive(env: Record<string, string | undefined> = process.env): boolean {
  return scanEnabled(env.NEXT_PUBLIC_KEEPLY_SCAN) && selectProvider({ env }).kind !== 'manual'
}

// A Supabase client acting as the caller (their own session), or null.
export function callerDb(request: NextRequest, env: Record<string, string | undefined> = process.env): SupabaseClient | null {
  const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey } = env
  const token = bearerToken(request.headers.get('authorization'))
  if (!url || !anonKey || !token) return null
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

// Reserves one billable attempt for the caller, or says why not. Never throws; fails closed.
export async function admitScan(
  request: NextRequest,
  env: Record<string, string | undefined> = process.env,
  reserve: (db: SupabaseClient) => Promise<ReserveResult> = reserveScan,
): Promise<ScanDecision> {
  if (scanAccessMode(env) === 'open') return 'allowed'
  const db = callerDb(request, env)
  if (!db) return 'unavailable'
  try {
    return await reserve(db)
  } catch (error) {
    console.error('[identify] scan reservation failed:', error instanceof Error ? error.message : error)
    return 'unavailable'
  }
}
