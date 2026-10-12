import 'server-only'
import type { ApplianceIdentity, LabelPhoto } from './identity'
import type { ExtractedPage, ExtractedTaskCandidate } from './extraction'
import { extractTasksWithMiniMax, identifyWithMiniMax, minimaxConfig } from './minimax'
import { extractTasksWithOpenRouter, identifyWithOpenRouter, openrouterConfig } from './openrouter'

// Where AI usage comes from (docs/HANDOFF.md §22). Separate from the Keeply account: being
// signed in to Keeply never implies the owner authorised any AI usage.
export type AiProviderKind =
  | 'openrouter' // OpenRouter API (server key, free vision model) — implemented
  | 'minimax' // MiniMax API (server key or the owner's saved BYO key) — implemented
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

// Preference order: ChatGPT-authorized (not built), then OpenRouter (free models), then MiniMax,
// then other server-keyed providers that are not built, then Manual. A saved BYO key is not its
// own candidate: the identify route passes that key as the only credential, so it is still chosen
// ahead of every server key.
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
  {
    kind: 'minimax',
    available: ({ env }) => minimaxConfig(env) !== null,
    create: ({ env, fetch: fetchImpl }) => {
      const config = minimaxConfig(env)!
      return {
        kind: 'minimax',
        identifyAppliance: (photo) => identifyWithMiniMax(config, photo, fetchImpl),
        extractTasks: ({ model, pages }) => {
          // The AI model is part of the resolved config. `model` is the appliance model, kept so
          // the provider signature stays uniform (e.g. ChatGPT, where the AI model comes from the
          // owner's plan, not the server).
          void model
          return extractTasksWithMiniMax(config, pages, fetchImpl)
        },
      }
    },
  },
  notBuilt('openai_api'),
  notBuilt('anthropic_api'),
  notBuilt('keeply_hosted'),
  { kind: 'manual', available: () => true, create: () => manualProvider },
]

// A provider refused the request over HTTP (rate limit, payment, 5xx, routing). A timeout or a
// network error has no status and is not retried elsewhere, so the request stays inside its time
// limit and takes the honest "AI unavailable" path.
function refusedOverHttp(error: unknown): boolean {
  return typeof (error as { status?: unknown } | null)?.status === 'number'
}

// The second configured provider answers when the first refuses. Both failing reports the first
// failure. One scan reservation covers both calls. A null reading or no tasks is an answer, not
// a failure, so it is never sent to the backup.
function withBackup(primary: AiProvider, backup: AiProvider): AiProvider {
  const run = async <T>(first: () => Promise<T>, second: () => Promise<T>): Promise<T> => {
    try {
      return await first()
    } catch (error) {
      if (!refusedOverHttp(error)) throw error
      try {
        return await second()
      } catch {
        throw error
      }
    }
  }
  return {
    kind: primary.kind,
    identifyAppliance: (photo) => run(() => primary.identifyAppliance(photo), () => backup.identifyAppliance(photo)),
    extractTasks: (input) => run(() => primary.extractTasks(input), () => backup.extractTasks(input)),
  }
}

// First available provider in preference order, with the next available one as its backup;
// Manual whenever nothing else can serve.
export function selectProvider(context: AiContext, candidates: readonly AiCandidate[] = CANDIDATES): AiProvider {
  const ready: AiProvider[] = []
  for (const candidate of candidates) {
    if (candidate.kind === 'manual') continue
    try {
      if (candidate.available(context)) ready.push(candidate.create(context))
    } catch {
      // A broken provider never blocks the owner: fall through to the next one.
    }
    if (ready.length === 2) break
  }
  if (ready.length === 0) return manualProvider
  return ready.length === 1 ? ready[0] : withBackup(ready[0], ready[1])
}
