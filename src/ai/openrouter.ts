import 'server-only'
import { parseExtractionReply, type ExtractedPage, type ExtractedTaskCandidate } from './extraction'
import { extractJsonObject, normaliseIdentity, type ApplianceIdentity, type LabelPhoto } from './identity'
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
// The model is configured because the free vision list changes. Free routes may be served by
// providers that train on prompts; every request sets provider.data_collection (default deny).
// A deny that leaves no endpoint is a routing failure, same as a rate limit, payment error,
// 5xx or timeout: the caller uses the honest "AI unavailable" path.

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1'
export const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-31b-it:free'
export const OPENROUTER_REFERER = 'https://keeply.vercel.app'
export const OPENROUTER_TITLE = 'Keeply'

export type OpenRouterDataCollection = 'deny' | 'allow'

export type OpenRouterConfig = {
  apiKey: string
  model: string
  baseUrl: string
  dataCollection: OpenRouterDataCollection
}

// Server env only. Unset means OpenRouter is not available. Anything other than `allow` stays
// on deny, so a typo cannot opt in to providers that may train on prompts.
export function openrouterConfig(env: Record<string, string | undefined>): OpenRouterConfig | null {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  if (!apiKey) return null
  const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL
  const dataCollection = env.OPENROUTER_DATA_COLLECTION?.trim().toLowerCase() === 'allow' ? 'allow' : 'deny'
  return { apiKey, model, baseUrl: OPENROUTER_BASE_URL, dataCollection }
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
  let result
  try {
    result = await completeChat({
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      model: config.model,
      messages,
      temperature: CHAT_TEMPERATURE,
      maxTokens,
      timeoutMs,
      extraHeaders: { 'HTTP-Referer': OPENROUTER_REFERER, 'X-Title': OPENROUTER_TITLE },
      extraBody: { provider: { data_collection: config.dataCollection } },
      fetchImpl,
    })
  } catch (error) {
    throw asProviderFailure(error)
  }
  // 429, 402, 5xx, and a 404 when data_collection: deny leaves no endpoint are all provider
  // failures. The response body is not copied onto the error: it can echo the prompt.
  if (!result.ok) throw new OpenRouterError(`OpenRouter rejected the request (${result.status})`, result.status)
  return result.content
}

export async function identifyWithOpenRouter(
  config: OpenRouterConfig,
  photo: LabelPhoto,
  fetchImpl: typeof fetch = fetch,
): Promise<ApplianceIdentity | null> {
  if (!labelPhotoAccepted(photo)) return null
  const content = await callOpenRouter(config, identifyMessages(photo), IDENTIFY_MAX_TOKENS, IDENTIFY_TIMEOUT_MS, fetchImpl)
  if (content == null) return null
  return normaliseIdentity(extractJsonObject(content))
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
  return parseExtractionReply(content, pageNumbers)
}
