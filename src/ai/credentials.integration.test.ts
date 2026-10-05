import { createHmac } from 'node:crypto'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { execFileSync } from 'node:child_process'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { deleteUserAiKey, getUserAiKey, saveUserAiKey } from './credentials'

const { KEEPLY_POSTGREST_URL, KEEPLY_JWT_SECRET, KEEPLY_INTEGRATION_DB } = process.env
const OWNER_A = '00000000-0000-4000-8000-0000000000e1'
const OWNER_B = '00000000-0000-4000-8000-0000000000e2'
const SERVICE_ROLE = '00000000-0000-4000-8000-0000000000e3'
const ENCRYPTION_KEY = Buffer.alloc(32, 43).toString('base64')
let proxy: Server | undefined
let supabaseUrl: string | undefined

function jwt(role: string) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: SERVICE_ROLE, role, exp: Math.floor(Date.now() / 1000) + 600 })}`
  return `${body}.${createHmac('sha256', KEEPLY_JWT_SECRET!).update(body).digest('base64url')}`
}

function fakeAuth(id: string): Pick<SupabaseClient['auth'], 'getUser'> {
  const user: User = {
    id,
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
    created_at: '2026-10-05T00:00:00.000Z',
    is_anonymous: false,
  }
  return { getUser: vi.fn(async () => ({ data: { user }, error: null })) }
}

beforeAll(async () => {
  if (!KEEPLY_INTEGRATION_DB || !KEEPLY_POSTGREST_URL || !KEEPLY_JWT_SECRET) return
  execFileSync('psql', [KEEPLY_INTEGRATION_DB, '-q', '-c', `insert into auth.users (id, email) values ('${OWNER_A}', 'credential-a@example.com'), ('${OWNER_B}', 'credential-b@example.com') on conflict do nothing`])
  const target = new URL(KEEPLY_POSTGREST_URL)
  proxy = createServer((req, res) => {
    const upstream = request(
      { host: target.hostname, port: target.port, path: req.url!.replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers },
      (response) => {
        res.writeHead(response.statusCode!, response.headers)
        response.pipe(res)
      },
    )
    req.pipe(upstream)
  })
  await new Promise<void>((resolve) => proxy!.listen(0, resolve))
  supabaseUrl = `http://localhost:${(proxy.address() as AddressInfo).port}`
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl)
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', jwt('service_role'))
  vi.stubEnv('KEEPLY_AI_KEY_ENCRYPTION_KEY', ENCRYPTION_KEY)
})

afterAll(async () => {
  if (KEEPLY_INTEGRATION_DB) execFileSync('psql', [KEEPLY_INTEGRATION_DB, '-q', '-c', `delete from auth.users where id in ('${OWNER_A}', '${OWNER_B}')`])
  if (proxy) await new Promise<void>((resolve) => proxy!.close(() => resolve()))
  vi.unstubAllEnvs()
})

describe.skipIf(!KEEPLY_POSTGREST_URL || !KEEPLY_JWT_SECRET || !KEEPLY_INTEGRATION_DB)('BYO credentials through PostgREST and Postgres', () => {
  it('stores ciphertext per verified user, isolates users, updates and deletes only the requested credential', async () => {
    const authA = fakeAuth(OWNER_A)
    const authB = fakeAuth(OWNER_B)
    await saveUserAiKey(authA, 'minimax', 'integration-secret-a')
    await saveUserAiKey(authB, 'minimax', 'integration-secret-b')

    await expect(getUserAiKey(authA, 'minimax')).resolves.toBe('integration-secret-a')
    await expect(getUserAiKey(authB, 'minimax')).resolves.toBe('integration-secret-b')

    await saveUserAiKey(authA, 'minimax', 'integration-secret-a-updated')
    await expect(getUserAiKey(authA, 'minimax')).resolves.toBe('integration-secret-a-updated')
    await expect(getUserAiKey(authB, 'minimax')).resolves.toBe('integration-secret-b')

    const admin = createClient(supabaseUrl!, jwt('service_role'), { auth: { persistSession: false } })
    const { data, error } = await admin.from('ai_credentials').select('user_id, provider, ciphertext, nonce, auth_tag').in('user_id', [OWNER_A, OWNER_B])
    expect(error).toBeNull()
    expect(data).toHaveLength(2)
    expect(data?.map((row) => row.ciphertext)).not.toContain('integration-secret-a-updated')
    expect(data?.map((row) => row.ciphertext)).not.toContain('integration-secret-b')

    await deleteUserAiKey(authA, 'minimax')
    await expect(getUserAiKey(authA, 'minimax')).resolves.toBeNull()
    await expect(getUserAiKey(authB, 'minimax')).resolves.toBe('integration-secret-b')

    const { error: deniedRead } = await createClient(supabaseUrl!, jwt('authenticated'), { auth: { persistSession: false } })
      .from('ai_credentials').select('*').eq('user_id', OWNER_B)
    expect(deniedRead).not.toBeNull()
  })
})
