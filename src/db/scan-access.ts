import type { SupabaseClient } from '@supabase/supabase-js'

// Invited-tester access to AI scanning, enforced in Postgres (migration 20261005100000).

export type ReserveResult = 'allowed' | 'signed_out' | 'no_invite' | 'tester_limit' | 'daily_limit'
export type RedeemResult = 'invited' | 'already_invited' | 'invalid' | 'signed_out'
export type Allowance = { status: 'invited' | 'no_invite' | 'signed_out'; testerLeft: number; globalLeft: number }

const RESERVE: readonly ReserveResult[] = ['allowed', 'signed_out', 'no_invite', 'tester_limit', 'daily_limit']
const REDEEM: readonly RedeemResult[] = ['invited', 'already_invited', 'invalid', 'signed_out']

async function rpc(db: SupabaseClient, name: string, args?: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await db.rpc(name, args)
  if (error) throw new Error(`Supabase: ${error.message}`)
  return data
}

// Counts one billable attempt against the caller's and the day's limits, atomically. Call before
// every billable provider request; anything but 'allowed' means do not call the provider. Attempts
// are never given back, since a failed or timed-out provider call may still be billed.
export async function reserveScan(db: SupabaseClient): Promise<ReserveResult> {
  const result = await rpc(db, 'reserve_scan')
  if (!RESERVE.includes(result as ReserveResult)) throw new Error(`Unexpected reserve_scan result: ${String(result)}`)
  return result as ReserveResult
}

export async function redeemInvite(db: SupabaseClient, code: string): Promise<RedeemResult> {
  const result = await rpc(db, 'redeem_scan_invite', { p_code: code })
  if (!REDEEM.includes(result as RedeemResult)) throw new Error(`Unexpected redeem result: ${String(result)}`)
  return result as RedeemResult
}

export async function scanAllowance(db: SupabaseClient): Promise<Allowance> {
  const raw = (await rpc(db, 'scan_allowance')) as { status?: string; tester_left?: number; global_left?: number } | null
  const status = raw?.status === 'invited' || raw?.status === 'no_invite' ? raw.status : 'signed_out'
  return { status, testerLeft: Number(raw?.tester_left ?? 0), globalLeft: Number(raw?.global_left ?? 0) }
}
