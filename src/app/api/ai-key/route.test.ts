import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ value: null as string | null }))
vi.mock('@/ai/credentials', () => ({
  getUserAiKey: vi.fn(async () => store.value),
  isCredentialStorageConfigured: vi.fn(() => true),
  saveUserAiKey: vi.fn(async (_client: unknown, _provider: unknown, key: string) => { store.value = key }),
  deleteUserAiKey: vi.fn(async () => { store.value = null }),
}))

import { GET, PUT, DELETE } from './route'

const origin = 'http://keeply.local'
const googleUser = { id: '12345678-1234-1234-1234-123456789012', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test', is_anonymous: false }
const anonUser = { ...googleUser, is_anonymous: true }
const authHeaders = { authorization: 'Bearer user-token' }

function request(method: string, options: { origin?: string; body?: string; user?: typeof googleUser | null; contentType?: string } = {}) {
  const headers: Record<string, string> = { ...authHeaders }
  if (options.origin !== undefined) headers.origin = options.origin
  if (options.body !== undefined) {
    headers['content-type'] = options.contentType ?? 'application/json'
    headers['content-length'] = String(new TextEncoder().encode(options.body).length)
  }
  const user = options.user === undefined ? googleUser : options.user
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.example')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url.includes('/auth/v1/user')) return user ? Response.json(user) : new Response('{}', { status: 401 })
    throw new Error(`Unexpected request: ${url}`)
  }))
  return new NextRequest(`${origin}/api/ai-key`, { method, headers, ...(options.body === undefined ? {} : { body: options.body }) })
}

beforeEach(() => { store.value = null })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('/api/ai-key', () => {
  it('reports only whether a credential is configured, never its value', async () => {
    store.value = 'private-test-key'
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    const response = await GET(request('GET'))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ configured: true, available: true, provider: 'minimax' })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(body)).not.toContain('private-test-key')
  })

  it('requires a verified signed-in nonanonymous user for reads and writes', async () => {
    expect((await GET(request('GET', { user: anonUser }))).status).toBe(401)
    const response = await PUT(request('PUT', { origin, body: JSON.stringify({ key: 'secret' }), user: anonUser }))
    expect(response.status).toBe(401)
    expect(store.value).toBeNull()
  })

  it('rejects cross-origin and oversized or malformed writes before storage', async () => {
    expect((await PUT(request('PUT', { origin: 'https://attacker.example', body: '{"key":"secret"}' }))).status).toBe(403)
    expect((await PUT(request('PUT', { origin, body: JSON.stringify({ key: 'x'.repeat(513) }) }))).status).toBe(400)
    expect((await PUT(request('PUT', { origin, body: JSON.stringify({ key: 'secret', provider: 'other' }) }))).status).toBe(400)
    expect((await PUT(request('PUT', { origin, body: '{' }))).status).toBe(400)
    const tokenPlan = await PUT(request('PUT', { origin, body: JSON.stringify({ key: 'sk-cp-private' }) }))
    expect(tokenPlan.status).toBe(400)
    expect(await tokenPlan.json()).toEqual({ error: 'unsupported_key' })
    expect(store.value).toBeNull()
  })

  it('saves and removes the key without returning it', async () => {
    const saved = await PUT(request('PUT', { origin, body: JSON.stringify({ key: 'private-test-key' }) }))
    expect(await saved.json()).toEqual({ saved: true })
    expect(await (await GET(request('GET'))).json()).toMatchObject({ configured: true })
    const removed = await DELETE(request('DELETE', { origin }))
    expect(await removed.json()).toEqual({ removed: true })
    expect(store.value).toBeNull()
  })
})
