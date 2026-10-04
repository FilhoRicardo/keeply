import { fitWithin } from '@/domain/identification'

// Shrinks a camera photo to a JPEG no larger than `maxEdge` pixels. Re-encoding through a canvas
// also drops EXIF metadata such as GPS location. Falls back to the original file where the
// browser cannot decode it.
export async function prepareLabelPhoto(file: Blob, maxEdge = 1280): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file
  try {
    const bitmap = await createImageBitmap(file)
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) return file
    context.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.8))
  } catch {
    return file
  }
}
