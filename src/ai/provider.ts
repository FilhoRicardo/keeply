import 'server-only'
import type { ApplianceIdentity, LabelPhoto } from './identity'
import { identifyWithMiniMax, minimaxConfig } from './minimax'

// Where AI usage comes from (docs/HANDOFF.md §22). Separate from the Keeply account: being
// signed in to Keeply never implies the owner authorised any AI usage.
export type AiProviderKind =
  | 'minimax' // MiniMax API (server key) — implemented
  | 'chatgpt_authorized' // the owner's ChatGPT plan — after OpenAI's requirements are confirmed
  | 'openai_api' // OpenAI API (server key) — optional
  | 'anthropic_api' // Anthropic API (server key) — optional
  | 'keeply_hosted' // Keeply-funded — future premium
  | 'manual' // no AI — always available

export type AiProvider = {
  kind: AiProviderKind
  // Reads an appliance label into Keeply's schema. A proposal only: the owner confirms or corrects.
  // Resolves to null when nothing usable was read.
  identifyAppliance(photo: LabelPhoto): Promise<ApplianceIdentity | null>
}

// What a provider may look at to decide whether it can serve this request. Credentials are read
// on the server only (this module is server-only).
export type AiContext = {
  env: Record<string, string | undefined>
  // The owner's own AI authorisation (e.g. ChatGPT plan usage), when granted. Not the Keeply login.
  authorisation?: { kind: 'chatgpt'; available: boolean } | null
  fetch?: typeof fetch
}

export type AiCandidate = {
  kind: AiProviderKind
  available(context: AiContext): boolean
  create(context: AiContext): AiProvider
}

export const manualProvider: AiProvider = { kind: 'manual', identifyAppliance: async () => null }

const notBuilt = (kind: AiProviderKind): AiCandidate => ({ kind, available: () => false, create: () => manualProvider })

// Preference order: the owner's own ChatGPT authorisation first (once built), then server-keyed
// providers, then Keeply-funded, then Manual.
export const CANDIDATES: readonly AiCandidate[] = [
  notBuilt('chatgpt_authorized'), // docs/ai/chatgpt-integration-plan.md
  {
    kind: 'minimax',
    available: ({ env }) => minimaxConfig(env) !== null,
    create: ({ env, fetch: fetchImpl }) => {
      const config = minimaxConfig(env)!
      return { kind: 'minimax', identifyAppliance: (photo) => identifyWithMiniMax(config, photo, fetchImpl) }
    },
  },
  notBuilt('openai_api'),
  notBuilt('anthropic_api'),
  notBuilt('keeply_hosted'),
  { kind: 'manual', available: () => true, create: () => manualProvider },
]

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
