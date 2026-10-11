import 'server-only'
import { EXTRACTION_INSTRUCTIONS, type ExtractedPage } from './extraction'
import { IDENTITY_INSTRUCTIONS, type LabelPhoto } from './identity'

// Shared OpenAI-compatible Chat Completions client. MiniMax and OpenRouter both speak this
// shape; provider-specific headers, body fields and error policy stay in each adapter.

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const
export const MAX_IMAGE_BYTES = 10_000_000
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

export function toDataUri({ bytes, mimeType }: LabelPhoto): string {
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

// Drops reasoning the model wrapped around the answer. A separate `reasoning` field is never read.
export function stripReasoning(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<reasoning>[\s\S]*?<\/reasoning>/g, '')
}

function messageText(content: unknown): string | null {
  if (typeof content === 'string') return stripReasoning(content)
  if (!Array.isArray(content)) return null
  let text = ''
  for (const part of content) {
    if (!part || typeof part !== 'object' || !('text' in part)) continue
    const value = (part as { text?: unknown }).text
    if (typeof value === 'string') text += value
  }
  return text.length > 0 ? stripReasoning(text) : null
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
}): Promise<ChatCompletion> {
  const fetchImpl = input.fetchImpl ?? fetch
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
    signal: AbortSignal.timeout(input.timeoutMs),
  })
  if (!response.ok) return { ok: false, status: response.status, content: null }
  const body = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[]
    base_resp?: { status_code?: number; status_msg?: string }
  }
  return {
    ok: true,
    status: response.status,
    content: messageText(body.choices?.[0]?.message?.content),
    baseResp: body.base_resp,
  }
}
