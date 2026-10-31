import { NextResponse, type NextRequest } from 'next/server'
import { redeemInvite, scanAllowance, type RedeemResult } from '@/db/scan-access'
import { aiScanLive, callerDb, scanAccessMode } from '../../lib/scan-gate'

// What the scan screen may promise before a photo is taken. Informational only: /api/identify
// reserves (and enforces) each scan itself.
export type ScanAccess =
  | { ai: false }
  | { ai: true; access: 'open' }
  | { ai: true; access: 'unavailable' | 'no_invite' }
  | { ai: true; access: 'invited'; testerLeft: number; globalLeft: number }

const noStore = { headers: { 'Cache-Control': 'no-store' } }

export async function GET(request: NextRequest) {
  if (!aiScanLive(process.env)) {
    return NextResponse.json({ ai: false } satisfies ScanAccess, noStore)
  }
  if (scanAccessMode() === 'open') return NextResponse.json({ ai: true, access: 'open' } satisfies ScanAccess, noStore)
  const db = callerDb(request)
  if (!db) return NextResponse.json({ ai: true, access: 'unavailable' } satisfies ScanAccess, noStore)
  try {
    const allowance = await scanAllowance(db)
    const body: ScanAccess =
      allowance.status === 'invited'
        ? { ai: true, access: 'invited', testerLeft: allowance.testerLeft, globalLeft: allowance.globalLeft }
        : { ai: true, access: allowance.status === 'no_invite' ? 'no_invite' : 'unavailable' }
    return NextResponse.json(body, noStore)
  } catch {
    return NextResponse.json({ ai: true, access: 'unavailable' } satisfies ScanAccess, noStore)
  }
}

export type RedeemResponse = { result: RedeemResult | 'unavailable' }

// Redeems an invite code for the caller's Keeply account (anonymous or Google). Works whether or
// not scanning is switched on yet, so testers can be invited ahead of time.
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (code.length < 4 || code.length > 40) return NextResponse.json({ result: 'invalid' } satisfies RedeemResponse, { status: 400 })
  const db = callerDb(request)
  if (!db) return NextResponse.json({ result: 'unavailable' } satisfies RedeemResponse, { status: 503 })
  try {
    return NextResponse.json({ result: await redeemInvite(db, code) } satisfies RedeemResponse, noStore)
  } catch {
    return NextResponse.json({ result: 'unavailable' } satisfies RedeemResponse, { status: 503 })
  }
}
