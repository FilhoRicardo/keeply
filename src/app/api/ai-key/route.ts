import { NextResponse, type NextRequest } from 'next/server'
import { deleteUserAiKey, getUserAiKey, isCredentialStorageConfigured, saveUserAiKey } from '@/ai/credentials'
import { scanEnabled } from '../../lib/features'
import { signedInCallerDb } from '../../lib/scan-gate'

const noStore = { headers: { 'Cache-Control': 'no-store' } }
const MAX_BODY_BYTES = 2048
const MAX_KEY_LENGTH = 512

function originMatches(request: NextRequest): boolean {
  const origin = request.headers.get('origin')
  return !!origin && origin === new URL(request.url).origin
}

async function readBody(request: NextRequest): Promise<unknown | null> {
  const length = Number(request.headers.get('content-length'))
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null
  if (!request.body) return null
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch {
    return null
  }
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, ...noStore })
}

// The credential value is deliberately never returned to the browser.
export async function GET(request: NextRequest) {
  const db = await signedInCallerDb(request)
  if (!db) return jsonError('unauthorized', 401)
  try {
    const key = await getUserAiKey(db.auth, 'minimax')
    return NextResponse.json(
      { configured: key !== null, available: scanEnabled() && isCredentialStorageConfigured(), provider: 'minimax' as const },
      noStore,
    )
  } catch {
    return jsonError('unavailable', 503)
  }
}

export async function PUT(request: NextRequest) {
  if (!originMatches(request)) return jsonError('forbidden', 403)
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') return jsonError('invalid_request', 400)
  const body = await readBody(request)
  const key = (body as { key?: unknown } | null)?.key
  if (
    !body || typeof body !== 'object' || Array.isArray(body) ||
    Object.keys(body).length !== 1 || typeof key !== 'string' ||
    key.length === 0 || key.length > MAX_KEY_LENGTH || key.trim() !== key
  ) return jsonError('invalid_request', 400)
  if (key.startsWith('sk-cp-')) return jsonError('unsupported_key', 400)
  if (/[\u0000-\u001f\u007f]/.test(key)) return jsonError('invalid_request', 400)

  const db = await signedInCallerDb(request)
  if (!db) return jsonError('unauthorized', 401)
  try {
    await saveUserAiKey(db.auth, 'minimax', key)
    return NextResponse.json({ saved: true }, noStore)
  } catch {
    return jsonError('unavailable', 503)
  }
}

export async function DELETE(request: NextRequest) {
  if (!originMatches(request)) return jsonError('forbidden', 403)
  const db = await signedInCallerDb(request)
  if (!db) return jsonError('unauthorized', 401)
  try {
    await deleteUserAiKey(db.auth, 'minimax')
    return NextResponse.json({ removed: true }, noStore)
  } catch {
    return jsonError('unavailable', 503)
  }
}
