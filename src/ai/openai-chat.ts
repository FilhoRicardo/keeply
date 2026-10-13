import 'server-only'
import { withE2eFixtures } from '@/e2e-fixtures/edge-fetch'
import { EXTRACTION_INSTRUCTIONS, type ExtractedPage } from './extraction'
import { IDENTITY_INSTRUCTIONS, type LabelPhoto } from './identity'

// Shared OpenAI-compatible Chat Completions client. MiniMax and OpenRouter both speak this
// shape; provider-specific headers, body fields and error policy stay in each adapter.

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
const MAX_IMAGE_BYTES = 10_000_000
export const CHAT_TEMPERATURE = 0.1
export const IDENTIFY_MAX_TOKENS = 400
export const EXTRACT_MAX_TOKENS = 2_000
export const IDENTIFY_TIMEOUT_MS = 25_000
export const EXTRACT_TIMEOUT_MS = 60_000

const MAX_PROMPT_CHARS = 60_000
const MAX_PAGES = 30

type ImagePart = { type: 'image_url'; image_url: { url: string; detail: 'high' } }
type TextPart = { type: 'text'; text: string }

export type ChatMessage = {
  role: 'system' | 'user'
  content: string | (TextPart | ImagePart)[]
}

export type ChatCompletion = {
  ok: boolean
  status: number
  // Assistant text with reasoning tags removed. Null when the model returned no text content.
  // A separate reasoning channel is ignored: it is not an answer.
  content: string | null
  baseResp?: { status_code?: number; status_msg?: string }
}

export function labelPhotoAccepted(photo: LabelPhoto): boolean {
  return (IMAGE_TYPES as readonly string[]).includes(photo.mimeType) && photo.bytes.length <= MAX_IMAGE_BYTES
}

function toDataUri({ bytes, mimeType }: LabelPhoto): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mimeType};base64,${btoa(binary)}`
}

export function identifyMessages(photo: LabelPhoto): ChatMessage[] {
  return [
    { role: 'system', content: IDENTITY_INSTRUCTIONS },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Read this appliance label.' },
        { type: 'image_url', image_url: { url: toDataUri(photo), detail: 'high' } },
      ],
    },
  ]
}

export function manualPagesPrompt(pages: readonly ExtractedPage[]): { prompt: string; pageNumbers: Set<number> } {
  const safePages = pages.slice(0, MAX_PAGES)
  const pageNumbers = new Set(safePages.map((page) => page.page))
  const prompt = safePages
    .map((page) => `[Page ${page.page}]\n${page.text}`)
    .join('\n\n')
    .slice(0, MAX_PROMPT_CHARS)
  return { prompt, pageNumbers }
}

export function extractionMessages(prompt: string): ChatMessage[] {
  return [
    { role: 'system', content: EXTRACTION_INSTRUCTIONS },
    { role: 'user', content: prompt },
  ]
}

// Drops reasoning the model wrapped around the answer. A separate `reasoning` field,
// `reasoning_content`, or `reasoning_details` is never read: only `message.content` is.
function stripReasoning(content: string): string {
  return content
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, '')
}

function answerText(part: unknown): string | null {
  if (typeof part === 'string') return part
  if (!part || typeof part !== 'object' || Array.isArray(part)) return null
  const record = part as Record<string, unknown>
  // Gemini marks a thought with `thought: true` even when `type` is "text". That draft is not the answer.
  if (record.thought === true) return null
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  if (type.startsWith('reasoning') || type === 'thinking' || type === 'thought' || type === 'redacted_thinking') return null
  if (type && type !== 'text' && type !== 'output_text') return null
  if (typeof record.text === 'string') return record.text
  // Some models put the answer on `content` inside a text part. A payload's own `content`
  // field is not that: only an explicit text part is read this way.
  if ((type === 'text' || type === 'output_text') && typeof record.content === 'string') return record.content
  return null
}

function messageText(content: unknown): string | null {
  if (typeof content === 'string') {
    const text = stripReasoning(content).trim()
    return text.length > 0 ? text : null
  }
  if (Array.isArray(content)) {
    let text = ''
    for (const part of content) text += answerText(part) ?? ''
    const stripped = stripReasoning(text).trim()
    return stripped.length > 0 ? stripped : null
  }
  if (!content || typeof content !== 'object') return null
  const record = content as Record<string, unknown>
  const text = answerText(record)
  if (text != null) return messageText(text)
  // A reasoning part is not an answer. A plain object is a structured payload some models return
  // instead of a string (`openrouter/free` picks a different model each request).
  if (typeof record.type === 'string') return null
  try {
    return JSON.stringify(content)
  } catch {
    return null
  }
}

export async function completeChat(input: {
  baseUrl: string
  apiKey: string
  model: string
  messages: readonly ChatMessage[]
  temperature: number
  maxTokens: number
  timeoutMs: number
  extraHeaders?: Record<string, string>
  extraBody?: Record<string, unknown>
  fetchImpl?: typeof fetch
  // When set, replaces the per-call timeout so a retry stays inside one deadline.
  signal?: AbortSignal
}): Promise<ChatCompletion> {
  const fetchImpl = withE2eFixtures(input.fetchImpl ?? fetch)
  const response = await fetchImpl(`${input.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...input.extraHeaders,
      Authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      max_tokens: input.maxTokens,
      ...input.extraBody,
    }),
    signal: input.signal ?? AbortSignal.timeout(input.timeoutMs),
  })
  if (!response.ok) {
    // Drop the body without reading it. Error payloads can echo the prompt or the key.
    try {
      await response.body?.cancel()
    } catch {
      // The error body is discarded either way.
    }
    return { ok: false, status: response.status, content: null }
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: unknown }; error?: { code?: unknown } }[]
    // OpenRouter reports a provider failure after the 200 status line was sent (a timeout, or an
    // error injected into the stream) as an `error` object, with no answer.
    error?: { code?: unknown }
    // MiniMax sometimes reports a failure here on HTTP 200. Callers decide whether that is fatal.
    base_resp?: { status_code?: number; status_msg?: string }
  }
  const failure = body.error ?? body.choices?.[0]?.error
  if (failure) {
    const code = typeof failure.code === 'number' && Number.isInteger(failure.code) ? failure.code : 502
    return { ok: false, status: code, content: null }
  }
  return {
    ok: true,
    status: response.status,
    content: messageText(body.choices?.[0]?.message?.content),
    baseResp: body.base_resp,
  }
}
