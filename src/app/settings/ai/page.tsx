import type { Metadata } from 'next'
import { Screen } from '../../components/screen'
import { MiniMaxKeySettings } from './minimax-key-settings'

export const metadata: Metadata = { title: 'AI settings · Keeply' }

export default function AiSettingsPage() {
  return (
    <Screen back={{ href: '/', label: 'Home' }} eyebrow="AI provider" title="MiniMax access">
      <MiniMaxKeySettings />
    </Screen>
  )
}
