import { NextResponse, type NextRequest } from 'next/server'
import { validateIdentification } from '@/domain/identification'
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
  const identification = proposal && validateIdentification(proposal) === null ? proposal : null
  return NextResponse.json({ identification }, { headers: { 'Cache-Control': 'no-store' } })
}
