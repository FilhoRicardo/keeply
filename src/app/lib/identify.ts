import { ACCESS_DENIALS, NOTHING_RECOGNISED, type AccessDenial, type ApplianceRecognizer, type RecognitionResult } from '@/domain/identification'

// Under Vercel's 4.5 MB request-body limit for functions.
export const MAX_PHOTO_BYTES = 4_000_000
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function checkPhoto(photo: { size: number; type: string } | null): string | null {
  if (!photo) return 'Attach a photo.'
  if (!PHOTO_TYPES.includes(photo.type)) return 'Use a JPEG, PNG or WebP photo.'
  if (photo.size === 0 || photo.size > MAX_PHOTO_BYTES) return 'The photo must be under 4 MB.'
  return null
}

// The server's refusal reasons, as the screen explains them. Anything else ('signed_out',
// 'unavailable') means AI was not reachable for this visitor; either way nothing was sent.
function denial(reason: unknown): AccessDenial {
  return ACCESS_DENIALS.find((d) => d === reason) ?? 'ai_unavailable'
}

// Browser side: asks the server's AI provider to read the label (Manual unless one is configured),
// sending the visitor's session so the server can check their invite and limits.
// A provider error, timeout, or unreachable identify route is `ai_unavailable`. A valid empty
// answer stays "nothing recognised". The owner can always type the details.
export function httpRecognizer(accessToken: () => Promise<string | null> = async () => null): ApplianceRecognizer {
  return {
    async recognise(photo) {
      try {
        const form = new FormData()
        form.append('photo', photo, 'label.jpg')
        const token = await accessToken().catch(() => null)
        const response = await fetch('/api/identify', {
          method: 'POST',
          body: form,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (response.status === 403) {
          const { reason } = (await response.json().catch(() => ({}))) as { reason?: string }
          return { identification: null, notice: denial(reason) }
        }
        if (response.status >= 500) return { identification: null, notice: 'ai_unavailable' }
        if (!response.ok) return NOTHING_RECOGNISED
        const { identification, notice } = (await response.json()) as Partial<RecognitionResult>
        return { identification: identification ?? null, notice: notice ?? null }
      } catch {
        return { identification: null, notice: 'ai_unavailable' }
      }
    },
  }
}
