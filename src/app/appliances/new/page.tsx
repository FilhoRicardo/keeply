import type { Metadata } from 'next'
import { Screen } from '../../components/screen'
import { NewApplianceForm } from './new-appliance-form'

export const metadata: Metadata = { title: 'Add appliance · Keeply' }

export default function NewAppliancePage() {
  return (
    <Screen back={{ href: '/', label: 'Home' }} eyebrow="Add manually" title="Your appliance">
      <NewApplianceForm />
    </Screen>
  )
}
