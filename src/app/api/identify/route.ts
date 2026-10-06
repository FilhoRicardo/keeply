import { NextResponse, type NextRequest } from 'next/server'
import {
  validateIdentification,
  type AccessDenial,
  type ApplianceIdentification,
} from '@/domain/identification'
import type { ApplianceIdentity } from '@/ai/identity'
import { selectProvider } from '@/ai/provider'
import { checkPhoto } from '../../lib/identify'
import { scanEnabled } from '../../lib/features'
import { admitScan, aiScanLive, userMiniMaxKey } from '../../lib/scan-gate'

// The MiniMax adapter waits up to 25 s; give the function room on Vercel.
export const maxDuration = 30

export type IdentifyResponse = {
  // Proposal for the Confirm / Edit / Rescan screen; never saved without the owner confirming.
  identification: ApplianceIdentification | null
  // Why there is no proposal (an access refusal). KEE-60: 'not_a_dishwasher' was retired — every
  // recognised appliance is a valid proposal and the owner confirms or edits it.
  notice: AccessDenial | null
}

// Keeply's neutral identity → the confirm screen's proposal. KEE-60: every appliance is a valid
// proposal. The category comes from the model as free text; the owner can edit it on the confirm
// screen. A reading without a manufacturer is still dropped (the confirm screen needs one).
export function toProposal(identity: ApplianceIdentity | null): IdentifyResponse {
  if (!identity) return { identification: null, notice: null }
  const proposal: ApplianceIdentification = {
    category: identity.applianceType,
    manufacturer: identity.manufacturer ?? '',
    model: identity.model ?? '',
    serialNumber: identity.serialNumber ?? '',
    confidence: identity.confidence,
    source: 'photo_recognition',
  }
  return { identification: wellFormed(proposal) ? proposal : null, notice: null }
}

// Reads an appliance label photo with the server's AI provider (Manual unless one is configured).
// The photo is never stored: it goes to the provider and is discarded.
export async function POST(request: NextRequest) {
  if (!scanEnabled()) return NextResponse.json({ error: 'not_enabled' }, { status: 404 })
  const form = await request.formData().catch(() => null)
  const photo = form?.get('photo')
  const file = photo instanceof Blob ? photo : null
  const problem = checkPhoto(file)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  // A saved user key always takes priority. If reading it fails, fail closed instead of quietly
  // charging the hosted key. User credentials are available only to verified Google accounts.
  let userKey: string | null
  try {
    userKey = await userMiniMaxKey(request)
  } catch {
    return NextResponse.json({ error: 'provider_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  const provider = userKey
    ? selectProvider({ env: { MINIMAX_API_KEY: userKey, MINIMAX_MODEL: 'MiniMax-M3' } })
    : selectProvider({ env: process.env })
  if (userKey && provider.kind === 'manual') {
    return NextResponse.json({ error: 'provider_unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
  // Billable providers only after an attempt is reserved for this caller; a refusal calls nothing.
  if (aiScanLive(process.env, userKey !== null)) {
    const decision = await admitScan(request)
    if (decision !== 'allowed') {
      return NextResponse.json({ error: 'scan_denied', reason: decision }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
    }
  }
  const identity = await provider
    .identifyAppliance({ bytes: new Uint8Array(await file!.arrayBuffer()), mimeType: file!.type })
    .catch(() => null)
  const body: IdentifyResponse = toProposal(identity)
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

// Proposals come from untrusted model output: check shape and rules before passing one on.
export function wellFormed(proposal: unknown): proposal is ApplianceIdentification {
  if (typeof proposal !== 'object' || proposal === null) return false
  const p = proposal as Record<string, unknown>
  const strings = ['manufacturer', 'model', 'serialNumber'].every((key) => typeof p[key] === 'string')
  const confidence = p.confidence === null || (typeof p.confidence === 'number' && Number.isFinite(p.confidence))
  if (!strings || !confidence || p.source !== 'photo_recognition') return false
  return validateIdentification(proposal as ApplianceIdentification) === null
}
