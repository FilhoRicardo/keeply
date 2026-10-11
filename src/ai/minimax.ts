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
  type ChatCompletion,
} from './openai-chat'

// MiniMax adapter. Everything MiniMax-specific stays in this file. The HTTP call and the
// reply parsing are shared with OpenRouter (`openai-chat.ts`).
// Docs (2026-10-04): OpenAI-compatible Chat Completions at https://api.minimax.io/v1; image input
// only on MiniMax-M3 and MiniMax-M3.1-Flash-Preview (the M2.x series is text-only); images as
// image_url content parts, base64 data URI accepted, ≤10 MB, JPEG/PNG/GIF/WEBP; thinking is on by
// default and is either split into reasoning_content or wrapped in <think> tags.
export const MINIMAX_VISION_MODELS = ['MiniMax-M3', 'MiniMax-M3.1-Flash-Preview'] as const
const DEFAULT_BASE_URL = 'https://api.minimax.io/v1'

export type MiniMaxConfig = { apiKey: string; model: string; baseUrl: string }

const MINIMAX_BODY = { thinking: { type: 'disabled' }, reasoning_split: true }

// Server env only. Unset, or a model without image input, means MiniMax is not available.
export function minimaxConfig(env: Record<string, string | undefined>): MiniMaxConfig | null {
  const apiKey = env.MINIMAX_API_KEY?.trim()
  const model = env.MINIMAX_MODEL?.trim() || 'MiniMax-M3'
  if (!apiKey || !(MINIMAX_VISION_MODELS as readonly string[]).includes(model)) return null
  return { apiKey, model, baseUrl: (env.MINIMAX_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '') }
}

export class MiniMaxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'MiniMaxError'
  }
}

function minimaxReply(result: ChatCompletion): string | null {
  if (!result.ok) throw new MiniMaxError(`MiniMax rejected the request (${result.status})`, result.status)
  // MiniMax reports some failures inside a 200 response.
  if (result.baseResp?.status_code) throw new MiniMaxError(`MiniMax error ${result.baseResp.status_code}: ${result.baseResp.status_msg ?? ''}`)
  return result.content
}

export async function identifyWithMiniMax(
  config: MiniMaxConfig,
  photo: LabelPhoto,
  fetchImpl: typeof fetch = fetch,
): Promise<ApplianceIdentity | null> {
  if (!labelPhotoAccepted(photo)) return null
  const content = minimaxReply(await completeChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    messages: identifyMessages(photo),
    temperature: CHAT_TEMPERATURE,
    maxTokens: IDENTIFY_MAX_TOKENS,
    timeoutMs: IDENTIFY_TIMEOUT_MS,
    extraBody: MINIMAX_BODY,
    fetchImpl,
  }))
  if (content == null) return null
  return normaliseIdentity(extractJsonObject(content))
}

// Sends a manual's pages to MiniMax and returns the cleaned task candidates. The model may return
// anything: malformed items are dropped by `parseExtractionReply` and never throw. A model reply
// that points a candidate at a page that was not sent is also dropped. A non-2xx, an in-body
// MiniMax error, a network timeout, or an aborted fetch throws `MiniMaxError` for HTTP failures
// and lets a network error from fetch propagate: the caller catches and falls back to general
// guidance (the reservation has already been charged and is never refunded, per docs/testers.md).
export async function extractTasksWithMiniMax(
  config: MiniMaxConfig,
  pages: readonly ExtractedPage[],
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractedTaskCandidate[]> {
  if (pages.length === 0) return []
  const { prompt, pageNumbers } = manualPagesPrompt(pages)
  const content = minimaxReply(await completeChat({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    messages: extractionMessages(prompt),
    temperature: CHAT_TEMPERATURE,
    maxTokens: EXTRACT_MAX_TOKENS,
    timeoutMs: EXTRACT_TIMEOUT_MS,
    extraBody: MINIMAX_BODY,
    fetchImpl,
  }))
  if (content == null) return []
  return parseExtractionReply(content, pageNumbers)
}
