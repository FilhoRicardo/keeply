import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Screen } from '../../../components/screen'
import { ApprovalSummary } from './approval-summary'

export const metadata: Metadata = { title: 'Approve plan · Keeply' }

export default async function ApprovePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Screen back={{ href: `/appliances/${id}/plan`, label: 'Plan' }} eyebrow="Final approval" title="Approve your plan">
      <Suspense>
        <ApprovalSummary applianceId={id} />
      </Suspense>
    </Screen>
  )
}
