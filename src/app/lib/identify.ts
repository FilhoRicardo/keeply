import { NOTHING_RECOGNISED, type ApplianceRecognizer, type RecognitionResult } from '@/domain/identification'

export const MAX_PHOTO_BYTES = 5_000_000
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function checkPhoto(photo: { size: number; type: string } | null): string | null {
  if (!photo) return 'Attach a photo.'
  if (!PHOTO_TYPES.includes(photo.type)) return 'Use a JPEG, PNG or WebP photo.'
  if (photo.size === 0 || photo.size > MAX_PHOTO_BYTES) return 'The photo must be under 5 MB.'
  return null
}

// Browser side: asks the server's AI provider to read the label (Manual unless one is configured).
// Any failure means "not recognised"; the owner can always type the details.
export const httpRecognizer: ApplianceRecognizer = {
  async recognise(photo) {
    try {
      const form = new FormData()
      form.append('photo', photo, 'label.jpg')
      const response = await fetch('/api/identify', { method: 'POST', body: form })
      if (!response.ok) return NOTHING_RECOGNISED
      const { identification, notice } = (await response.json()) as Partial<RecognitionResult>
      return { identification: identification ?? null, notice: notice === 'not_a_dishwasher' ? notice : null }
    } catch {
      return NOTHING_RECOGNISED
    }
  },
}
