import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Screen } from '../../components/screen'
import { ApplianceRecordView } from './appliance-record'

export const metadata: Metadata = { title: 'Dishwasher · Keeply' }

export default async function AppliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Screen back={{ href: '/', label: 'Home' }} eyebrow="Appliance record" title="Your dishwasher">
      <Suspense>
        <ApplianceRecordView applianceId={id} />
      </Suspense>
    </Screen>
  )
}
