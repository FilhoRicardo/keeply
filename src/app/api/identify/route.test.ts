import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'

function post(photo?: Blob) {
  const form = new FormData()
  if (photo) form.append('photo', photo, 'label.jpg')
  return POST(new NextRequest('http://keeply.local/api/identify', { method: 'POST', body: form }))
}

afterEach(() => vi.unstubAllEnvs())

describe('POST /api/identify', () => {
  it('is off unless scanning is enabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '')
    expect((await post(new Blob(['x'], { type: 'image/jpeg' }))).status).toBe(404)
  })

  it('validates the photo', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    expect((await post()).status).toBe(400)
    expect((await post(new Blob(['x'], { type: 'application/pdf' }))).status).toBe(400)
    expect((await post(new Blob([new Uint8Array(5_000_001)], { type: 'image/jpeg' }))).status).toBe(400)
  })

  it('recognises nothing in v0.1', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    const response = await post(new Blob(['x'], { type: 'image/jpeg' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ identification: null })
  })
})
