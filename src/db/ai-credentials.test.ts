import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClient = vi.hoisted(() => vi.fn())
vi.mock('@supabase/supabase-js', () => ({ createClient }))

import {
  isAiCredentialStorageConfigured,
  readEncryptedAiCredential,
  removeEncryptedAiCredential,
  writeEncryptedAiCredential,
} from './ai-credentials'

const table = {
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  table.select.mockReturnValue(table)
  table.eq.mockReturnValue(table)
  table.delete.mockReturnValue(table)
  table.maybeSingle.mockResolvedValue({ data: null, error: null })
  table.upsert.mockResolvedValue({ error: null })
  createClient.mockReturnValue({ from: vi.fn(() => table) })
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret'
})

describe('service-only AI credential database access', () => {
  it('creates a non-persistent service-role client and reads only the requested user/provider ciphertext', async () => {
    await readEncryptedAiCredential('verified-user', 'minimax')
    expect(createClient).toHaveBeenCalledWith('https://example.supabase.co', 'service-role-secret', {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
    expect(table.select).toHaveBeenCalledWith('ciphertext, nonce, auth_tag')
    expect(table.eq).toHaveBeenNthCalledWith(1, 'user_id', 'verified-user')
    expect(table.eq).toHaveBeenNthCalledWith(2, 'provider', 'minimax')
  })

  it('encodes and decodes encrypted bytes as base64 without treating them as plaintext', async () => {
    table.maybeSingle.mockResolvedValue({
      data: { ciphertext: 'Y2lwaGVydGV4dA==', nonce: 'bm9uY2U=', auth_tag: 'YXV0aFRhZw==' }, error: null,
    })
    await expect(readEncryptedAiCredential('user', 'minimax')).resolves.toEqual({
      ciphertext: Buffer.from('ciphertext'), nonce: Buffer.from('nonce'), authTag: Buffer.from('authTag'),
    })
    await writeEncryptedAiCredential('user', 'minimax', {
      ciphertext: Buffer.from('ciphertext'), nonce: Buffer.from('nonce'), authTag: Buffer.from('authTag'),
    })
    expect(table.upsert).toHaveBeenCalledWith({
      user_id: 'user', provider: 'minimax', ciphertext: 'Y2lwaGVydGV4dA==', nonce: 'bm9uY2U=', auth_tag: 'YXV0aFRhZw==',
    }, { onConflict: 'user_id,provider' })
  })

  it('deletes only the requested user/provider row', async () => {
    await removeEncryptedAiCredential('verified-user', 'minimax')
    expect(table.delete).toHaveBeenCalledOnce()
    expect(table.eq).toHaveBeenNthCalledWith(1, 'user_id', 'verified-user')
    expect(table.eq).toHaveBeenNthCalledWith(2, 'provider', 'minimax')
  })

  it('fails closed on missing server credentials and sanitizes database failures', async () => {
    expect(isAiCredentialStorageConfigured({})).toBe(false)
    expect(isAiCredentialStorageConfigured({ NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'x' })).toBe(true)
    table.maybeSingle.mockResolvedValue({ data: null, error: { message: 'secret-bearing raw error' } })
    await expect(readEncryptedAiCredential('user', 'minimax')).rejects.toThrow('AI credential storage failed.')
    await expect(readEncryptedAiCredential('user', 'minimax')).rejects.not.toThrow('secret-bearing raw error')
  })
})
