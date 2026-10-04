import type { Metadata } from 'next'
import { Screen } from '../../components/screen'
import { NewApplianceForm } from './new-appliance-form'

export const metadata: Metadata = { title: 'Add dishwasher · Keeply' }

export default function NewAppliancePage() {
  return (
    <Screen back={{ href: '/', label: 'Home' }} eyebrow="Add manually" title="Your dishwasher">
      <NewApplianceForm />
    </Screen>
  )
}
