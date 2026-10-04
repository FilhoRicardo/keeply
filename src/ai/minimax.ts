import 'server-only'
import { extractJsonObject, IDENTITY_INSTRUCTIONS, normaliseIdentity, type ApplianceIdentity, type LabelPhoto } from './identity'

// MiniMax adapter. Everything MiniMax-specific stays in this file.
// Docs (2026-10-04): OpenAI-compatible Chat Completions at https://api.minimax.io/v1; image input
// only on MiniMax-M3 and MiniMax-M3.1-Flash-Preview (the M2.x series is text-only); images as
// image_url content parts, base64 data URI accepted, ≤10 MB, JPEG/PNG/GIF/WEBP; thinking is on by
// default and is either split into reasoning_content or wrapped in <think> tags.
export const MINIMAX_VISION_MODELS = ['MiniMax-M3', 'MiniMax-M3.1-Flash-Preview'] as const
const DEFAULT_BASE_URL = 'https://api.minimax.io/v1'
const MAX_IMAGE_BYTES = 10_000_000
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

export type MiniMaxConfig = { apiKey: string; model: string; baseUrl: string }

// Server env only. Unset, or a model without image input, means MiniMax is not available.
export function minimaxConfig(env: Record<string, string | undefined>): MiniMaxConfig | null {
  const apiKey = env.MINIMAX_API_KEY?.trim()
  const model = env.MINIMAX_MODEL?.trim() || 'MiniMax-M3'
  if (!apiKey || !(MINIMAX_VISION_MODELS as readonly string[]).includes(model)) return null
  return { apiKey, model, baseUrl: (env.MINIMAX_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '') }
}

function toDataUri({ bytes, mimeType }: LabelPhoto): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${mimeType};base64,${btoa(binary)}`
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

export async function identifyWithMiniMax(
  config: MiniMaxConfig,
  photo: LabelPhoto,
  fetchImpl: typeof fetch = fetch,
): Promise<ApplianceIdentity | null> {
  if (!IMAGE_TYPES.includes(photo.mimeType) || photo.bytes.length > MAX_IMAGE_BYTES) return null
  const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: IDENTITY_INSTRUCTIONS },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Read this appliance label.' },
            { type: 'image_url', image_url: { url: toDataUri(photo), detail: 'high' } },
          ],
        },
      ],
      // Label reading needs no long reasoning; keep any that happens out of the content.
      thinking: { type: 'disabled' },
      reasoning_split: true,
      temperature: 0.1,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(25_000),
  })
  if (!response.ok) throw new MiniMaxError(`MiniMax rejected the request (${response.status})`, response.status)
  const body = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[]
    base_resp?: { status_code?: number; status_msg?: string }
  }
  // MiniMax reports some failures inside a 200 response.
  if (body.base_resp?.status_code) throw new MiniMaxError(`MiniMax error ${body.base_resp.status_code}: ${body.base_resp.status_msg ?? ''}`)
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string') return null
  const reply = content.replace(/<think>[\s\S]*?<\/think>/g, '')
  return normaliseIdentity(extractJsonObject(reply))
}
