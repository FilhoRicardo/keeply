import type { Metadata } from 'next'
import { Suspense } from 'react'
import { Screen } from '../components/screen'
import { InviteForm } from './invite-form'

export const metadata: Metadata = { title: 'Tester invite · Keeply' }

export default function InvitePage() {
  return (
    <Screen back={{ href: '/', label: 'Home' }} eyebrow="Tester invite" title="AI label reading">
      <Suspense>
        <InviteForm />
      </Suspense>
    </Screen>
  )
}
