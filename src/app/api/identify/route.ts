import { NextResponse, type NextRequest } from 'next/server'
import { validateIdentification, type ApplianceIdentification } from '@/domain/identification'
import type { ApplianceIdentity } from '@/ai/identity'
import { selectProvider } from '@/ai/provider'
import { checkPhoto } from '../../lib/identify'
import { scanEnabled } from '../../lib/features'
import { admitScan, aiScanLive } from '../../lib/scan-gate'

// The MiniMax adapter waits up to 25 s; give the function room on Vercel.
export const maxDuration = 30

export type IdentifyResponse = {
  // Proposal for the Confirm / Edit / Rescan screen; never saved without the owner confirming.
  identification: ApplianceIdentification | null
  // Why there is no proposal, when the provider read something that is not usable.
  notice: 'not_a_dishwasher' | null
}

// Keeply's neutral identity → the confirm screen's proposal. Labels rarely say "dishwasher", so an
// unknown type with a readable manufacturer is still proposed; "other" is not.
export function toProposal(identity: ApplianceIdentity | null): IdentifyResponse {
  if (!identity) return { identification: null, notice: null }
  if (identity.applianceType === 'other') return { identification: null, notice: 'not_a_dishwasher' }
  const proposal: ApplianceIdentification = {
    category: 'dishwasher',
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

  const provider = selectProvider({ env: process.env })
  // Billable providers only after an attempt is reserved for this caller; a refusal calls nothing.
  if (aiScanLive()) {
    const decision = await admitScan(request)
    if (decision !== 'allowed') {
      return NextResponse.json({ error: 'scan_denied', reason: decision }, { status: 403, headers: { 'Cache-Control': 'no-store' } })
    }
  }
  const identity = await provider
    .identifyAppliance({ bytes: new Uint8Array(await file!.arrayBuffer()), mimeType: file!.type })
    .catch((error: unknown) => {
      // The attempt still counts: the provider may have billed it.
      console.error(`[identify] ${provider.kind} failed:`, error instanceof Error ? error.message : error)
      return null
    })
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
