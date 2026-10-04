import { NextResponse, type NextRequest } from 'next/server'
import { validateIdentification, type ApplianceIdentification } from '@/domain/identification'
import { checkPhoto, serverRecognizer } from '../../lib/identify'
import { scanEnabled } from '../../lib/features'

// Reads an appliance label photo. The photo is not stored here; the owner's confirmed photo is
// saved with the appliance. Results are proposals only.
export async function POST(request: NextRequest) {
  if (!scanEnabled()) return NextResponse.json({ error: 'not_enabled' }, { status: 404 })
  const form = await request.formData().catch(() => null)
  const photo = form?.get('photo')
  const file = photo instanceof Blob ? photo : null
  const problem = checkPhoto(file)
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const proposal = await serverRecognizer().recognise(file!).catch(() => null)
  // Never pass on a malformed proposal.
  const identification = wellFormed(proposal) ? proposal : null
  return NextResponse.json({ identification }, { headers: { 'Cache-Control': 'no-store' } })
}

// A recogniser's output is untrusted (for example parsed model JSON): check its shape before
// validating it, so a malformed proposal is dropped rather than crashing the route.
export function wellFormed(proposal: unknown): proposal is ApplianceIdentification {
  if (typeof proposal !== 'object' || proposal === null) return false
  const p = proposal as Record<string, unknown>
  const strings = ['manufacturer', 'model', 'serialNumber'].every((key) => typeof p[key] === 'string')
  const confidence = p.confidence === null || (typeof p.confidence === 'number' && Number.isFinite(p.confidence))
  if (!strings || !confidence || p.source !== 'photo_recognition') return false
  return validateIdentification(proposal as ApplianceIdentification) === null
}
