import 'server-only'
import { noRecognizer, type ApplianceRecognizer } from '@/domain/identification'

// Where AI usage comes from (docs/HANDOFF.md §22). Separate from the Keeply account: being
// signed in to Keeply never implies the owner authorised any AI usage.
export type AiProviderKind = 'chatgpt_authorized' | 'byo_api_key' | 'keeply_hosted' | 'manual'

export type AiProvider = {
  kind: AiProviderKind
  // Reads an appliance label. Proposals only: the owner confirms or corrects.
  recogniser: ApplianceRecognizer
}

// What a provider may look at to decide whether it can serve this request. Credentials are read
// on the server only (this module is server-only).
export type AiContext = {
  env: Record<string, string | undefined>
  // The owner's own AI authorisation (e.g. ChatGPT plan usage), when they have granted one.
  // Not the Keeply login.
  authorisation?: { kind: 'chatgpt'; available: boolean } | null
}

export type AiCandidate = {
  kind: AiProviderKind
  available(context: AiContext): boolean
  create(context: AiContext): AiProvider
}

// Preference order. Only Manual is implemented in v0.1:
// - chatgpt_authorized: waits on OpenAI's confirmation (docs/ai/chatgpt-integration-plan.md).
// - byo_api_key / keeply_hosted: not built yet; must never take a key from the browser.
export const CANDIDATES: readonly AiCandidate[] = [
  { kind: 'chatgpt_authorized', available: () => false, create: () => manualProvider },
  { kind: 'byo_api_key', available: () => false, create: () => manualProvider },
  { kind: 'keeply_hosted', available: () => false, create: () => manualProvider },
  { kind: 'manual', available: () => true, create: () => manualProvider },
]

export const manualProvider: AiProvider = { kind: 'manual', recogniser: noRecognizer }

// First available provider in preference order; Manual whenever nothing else can serve.
export function selectProvider(context: AiContext, candidates: readonly AiCandidate[] = CANDIDATES): AiProvider {
  for (const candidate of candidates) {
    try {
      if (candidate.available(context)) return candidate.create(context)
    } catch {
      // A broken provider never blocks the owner: fall through to the next one.
    }
  }
  return manualProvider
}
