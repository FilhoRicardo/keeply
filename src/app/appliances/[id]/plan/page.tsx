import type { Metadata } from 'next'
import { Screen } from '../../../components/screen'
import { PlanReview } from './plan-review'

export const metadata: Metadata = { title: 'Proposed plan · Keeply' }

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <Screen back={{ href: '/', label: 'Home' }} eyebrow="Proposed maintenance plan" title="Review each task">
      <PlanReview applianceId={id} />
    </Screen>
  )
}
