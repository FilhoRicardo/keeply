import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Screen } from '../../components/screen'
import { scanEnabled } from '../../lib/features'
import { ScanFlow } from './scan-flow'

export const metadata: Metadata = { title: 'Scan appliance · Keeply' }

export default function ScanPage() {
  if (!scanEnabled()) notFound()
  return (
    <Screen back={{ href: '/', label: 'Home' }} eyebrow="Scan appliance" title="Photograph the label">
      <ScanFlow />
    </Screen>
  )
}
