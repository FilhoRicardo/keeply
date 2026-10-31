import 'server-only'
import type { ApplianceIdentity, LabelPhoto } from './identity'
import type { ExtractedPage, ExtractedTaskCandidate } from './extraction'
import { extractTasksWithOpenRouter, identifyWithOpenRouter, openrouterConfig } from './openrouter'

// Where AI usage comes from (docs/HANDOFF.md §22). Separate from the Keeply account: being
// signed in to Keeply never implies the owner authorised any AI usage.
export type AiProviderKind =
  | 'openrouter' // OpenRouter API (server key) — implemented
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
  // Reads the pages of a manufacturer manual and returns the model's candidate maintenance tasks.
  // Returns 'unavailable' when this provider has no configured way to read manuals (e.g. Manual
  // or any provider that has not implemented extraction yet); the caller falls back to general
  // guidance. Otherwise returns the cleaned candidates; the caller is responsible for deciding
  // the evidence level (P3-1, `verifyQuote` + `classifyEvidence`) and for reserving one billable
  // attempt before the call. A provider that has not implemented extraction yet may also return
  // 'unavailable' even when configured; that is fine — the caller's reservation has already been
  // charged and is never refunded (docs/testers.md).
  extractTasks(input: { model: string; pages: readonly ExtractedPage[] }): Promise<ExtractedTaskCandidate[] | 'unavailable'>
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

export const manualProvider: AiProvider = {
  kind: 'manual',
  identifyAppliance: async () => null,
  // Manual never reads a model; the caller falls back to general guidance.
  extractTasks: async () => 'unavailable',
}

const notBuilt = (kind: AiProviderKind): AiCandidate => ({
  kind,
  available: () => false,
  create: () => manualProvider,
})

// Preference order: ChatGPT-authorized (not built), then OpenRouter, then other server-keyed
// providers that are not built, then Manual. MiniMax was retired (RF-357); OpenRouter is the sole
// implemented AI provider. Manual always works.
export const CANDIDATES: readonly AiCandidate[] = [
  notBuilt('chatgpt_authorized'), // docs/ai/chatgpt-integration-plan.md
  {
    kind: 'openrouter',
    available: ({ env }) => openrouterConfig(env) !== null,
    create: ({ env, fetch: fetchImpl }) => {
      const config = openrouterConfig(env)!
      return {
        kind: 'openrouter',
        identifyAppliance: (photo) => identifyWithOpenRouter(config, photo, fetchImpl),
        extractTasks: ({ model, pages }) => {
          void model
          return extractTasksWithOpenRouter(config, pages, fetchImpl)
        },
      }
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
    if (candidate.kind === 'manual') continue
    try {
      if (candidate.available(context)) return candidate.create(context)
    } catch {
      // A broken provider never blocks the owner: fall through to the next one.
    }
  }
  return manualProvider
}
