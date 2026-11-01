import 'server-only'
import { normaliseExtraction, type ExtractedPage, type ExtractedTaskCandidate } from './extraction'
import { extractJsonValues, normaliseIdentity, type ApplianceIdentity, type LabelPhoto } from './identity'
import {
  CHAT_TEMPERATURE,
  completeChat,
  EXTRACT_MAX_TOKENS,
  EXTRACT_TIMEOUT_MS,
  extractionMessages,
  IDENTIFY_MAX_TOKENS,
  IDENTIFY_TIMEOUT_MS,
  identifyMessages,
  labelPhotoAccepted,
  manualPagesPrompt,
  type ChatMessage,
} from './openai-chat'

// OpenRouter adapter. OpenAI-compatible Chat Completions at https://openrouter.ai/api/v1.
// The model is configured. `openrouter/free` picks a free model per request (the pinned Gemma
// free model returned 429 on every live call). Free routes may be served by providers that
// train on prompts; every request sets provider.data_collection (default deny).
// A deny that leaves no endpoint is a routing failure, same as a rate limit, payment error,
// 5xx or timeout: the caller uses the honest "AI unavailable" path. One 429 is retried on the
// same deadline; the retry does not start a new timeout.

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_OPENROUTER_MODEL = 'openrouter/free'
export const DEFAULT_SITE_URL = 'http://localhost:3000'
export const DEFAULT_OPENROUTER_TITLE = 'Keeply'

export type OpenRouterDataCollection = 'deny' | 'allow'

export type OpenRouterConfig = {
  apiKey: string
  model: string
  baseUrl: string
  dataCollection: OpenRouterDataCollection
  referer: string
  title: string
}

function openRouterAttribution(env: Record<string, string | undefined>): { referer: string; title: string } {
  const referer =
    env.OPENROUTER_HTTP_REFERER?.trim() || env.NEXT_PUBLIC_SITE_URL?.trim() || DEFAULT_SITE_URL
  return { referer, title: DEFAULT_OPENROUTER_TITLE }
}

// Server env only. Unset means OpenRouter is not available. Anything other than `allow` stays
// on deny, so a typo cannot opt in to providers that may train on prompts.
export function openrouterConfig(env: Record<string, string | undefined>): OpenRouterConfig | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null
  const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL
  const dataCollection = env.OPENROUTER_DATA_COLLECTION?.trim().toLowerCase() === 'allow' ? 'allow' : 'deny'
  const { referer, title } = openRouterAttribution(env)
  return { apiKey, model, baseUrl: OPENROUTER_BASE_URL, dataCollection, referer, title }
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'OpenRouterError'
  }
}

function asProviderFailure(error: unknown): OpenRouterError {
  if (error instanceof OpenRouterError) return error
  const name = error instanceof Error ? error.name : ''
  if (name === 'TimeoutError' || name === 'AbortError') return new OpenRouterError('OpenRouter timed out')
  return new OpenRouterError('OpenRouter request failed')
}

async function callOpenRouter(
  config: OpenRouterConfig,
  messages: readonly ChatMessage[],
  maxTokens: number,
  timeoutMs: number,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  // One deadline for the attempt and, when the first response is 429, the single retry.
  const signal = AbortSignal.timeout(timeoutMs)
  const once = async () => {
    try {
      return await completeChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages,
        temperature: CHAT_TEMPERATURE,
        maxTokens,
        timeoutMs,
        extraHeaders: { 'HTTP-Referer': config.referer, 'X-Title': config.title },
        // Reasoning models routed by `openrouter/free` otherwise spend the whole token budget
        // thinking and return no content (live: dots-3-note, finish_reason "length").
        extraBody: { provider: { data_collection: config.dataCollection }, reasoning: { enabled: false } },
        fetchImpl,
        signal,
      })
    } catch (error) {
      throw asProviderFailure(error)
    }
  }
  let result = await once()
  if (!result.ok && result.status === 429 && !signal.aborted) result = await once()
  // 429 (after one retry), 402, 5xx, a 404 when data_collection: deny leaves no endpoint, and the
  // same codes reported inside a 200 reply (a provider that timed out after the stream began)
  // are all provider failures. The response body is not copied onto the error: it can echo the prompt.
  if (!result.ok) throw new OpenRouterError(`OpenRouter rejected the request (${result.status})`, result.status)
  return result.content
}

function hasIdentityFields(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return 'applianceType' in value || 'manufacturer' in value || 'model' in value || 'serialNumber' in value
}

// `openrouter/free` serves a different model each request. Take the last object that actually
// carries an identity, including one nested under a wrapper, and ignore a nested fragment of
// an object that is already an identity (a draft `model` must not replace the label read).
function identityFromReply(content: string): ApplianceIdentity | null {
  const matches: Record<string, unknown>[] = []
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (hasIdentityFields(value)) {
      matches.push(value)
      return
    }
    if (!value || typeof value !== 'object') return
    for (const child of Object.values(value)) visit(child)
  }
  for (const value of extractJsonValues(content)) visit(value)
  const match = matches[matches.length - 1]
  return match ? normaliseIdentity(match) : null
}

function candidateList(value: unknown): unknown[] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const list = (value as Record<string, unknown>).candidates
  return Array.isArray(list) ? list : null
}

// Prefer the last `{candidates: [...]}` object. A bare array of objects is accepted when a
// routed model skips the wrapper. A later list replaces an earlier one; a candidates object
// wins over a bare array.
function tasksFromReply(content: string, pageNumbers: ReadonlySet<number>): ExtractedTaskCandidate[] {
  let wrapped: unknown[] | null = null
  let bare: unknown[] | null = null
  for (const value of extractJsonValues(content)) {
    if (Array.isArray(value)) {
      if (value.some((item) => item !== null && typeof item === 'object' && !Array.isArray(item))) bare = value
      continue
    }
    const list = candidateList(value)
    if (list) {
      wrapped = list
      continue
    }
    if (!value || typeof value !== 'object') continue
    for (const child of Object.values(value)) {
      const nested = candidateList(child)
      if (nested) wrapped = nested
    }
  }
  const list = wrapped ?? bare
  if (!list) return []
  return normaliseExtraction({ candidates: list }, pageNumbers)
}

export async function identifyWithOpenRouter(
  config: OpenRouterConfig,
  photo: LabelPhoto,
  fetchImpl: typeof fetch = fetch,
): Promise<ApplianceIdentity | null> {
  if (!labelPhotoAccepted(photo)) return null
  const content = await callOpenRouter(config, identifyMessages(photo), IDENTIFY_MAX_TOKENS, IDENTIFY_TIMEOUT_MS, fetchImpl)
  if (content == null) return null
  return identityFromReply(content)
}

export async function extractTasksWithOpenRouter(
  config: OpenRouterConfig,
  pages: readonly ExtractedPage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractedTaskCandidate[]> {
  if (pages.length === 0) return []
  const { prompt, pageNumbers } = manualPagesPrompt(pages)
  const content = await callOpenRouter(config, extractionMessages(prompt), EXTRACT_MAX_TOKENS, EXTRACT_TIMEOUT_MS, fetchImpl)
  if (content == null) return []
  return tasksFromReply(content, pageNumbers)
}
