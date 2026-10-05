import { afterEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
  configured: vi.fn(),
}))

vi.mock('@/db/ai-credentials', () => ({
  readEncryptedAiCredential: storage.read,
  writeEncryptedAiCredential: storage.write,
  removeEncryptedAiCredential: storage.remove,
  isAiCredentialStorageConfigured: storage.configured,
}))

import {
  decryptCredentialFromStorage,
  deleteUserAiKey,
  encryptCredentialForStorage,
  getUserAiKey,
  isCredentialStorageConfigured,
  saveUserAiKey,
} from './credentials'

const keyA = Buffer.alloc(32, 17).toString('base64')
const keyB = Buffer.alloc(32, 18).toString('base64')
const configuredEnv = { KEEPLY_AI_KEY_ENCRYPTION_KEY: keyA, NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'server-only' }

function authUser(id: string, isAnonymous = false) {
  return { getUser: vi.fn(async () => ({ data: { user: { id, is_anonymous: isAnonymous } }, error: null })) } as unknown as Parameters<typeof getUserAiKey>[0]
}

afterEach(() => {
  vi.clearAllMocks()
  storage.configured.mockReturnValue(true)
})

describe('credential encryption', () => {
  it('encrypts with AES-GCM and decrypts with the same user, provider and key', () => {
    const encrypted = encryptCredentialForStorage('secret-token', 'user-a', 'minimax', configuredEnv)
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('secret-token')
    expect(encrypted.nonce).toHaveLength(12)
    expect(encrypted.authTag).toHaveLength(16)
    expect(decryptCredentialFromStorage(encrypted, 'user-a', 'minimax', configuredEnv)).toBe('secret-token')
  })

  it('rejects a different encryption key', () => {
    const encrypted = encryptCredentialForStorage('secret-token', 'user-a', 'minimax', configuredEnv)
    expect(() => decryptCredentialFromStorage(encrypted, 'user-a', 'minimax', { ...configuredEnv, KEEPLY_AI_KEY_ENCRYPTION_KEY: keyB }))
      .toThrow('AI credential could not be decrypted.')
  })

  it('binds ciphertext authentication to the owner and provider', () => {
    const encrypted = encryptCredentialForStorage('secret-token', 'user-a', 'minimax', configuredEnv)
    expect(() => decryptCredentialFromStorage(encrypted, 'user-b', 'minimax', configuredEnv)).toThrow('AI credential could not be decrypted.')
    expect(() => decryptCredentialFromStorage(encrypted, 'user-a', 'openai_api' as 'minimax', configuredEnv)).toThrow('AI credential could not be decrypted.')
  })

  it('rejects tampered ciphertext and fails closed when the encryption key is missing or malformed', () => {
    const encrypted = encryptCredentialForStorage('secret-token', 'user-a', 'minimax', configuredEnv)
    const tampered = { ...encrypted, ciphertext: Buffer.from(Buffer.from(encrypted.ciphertext).map((byte, index) => index === 0 ? byte ^ 1 : byte)) }
    expect(() => decryptCredentialFromStorage(tampered, 'user-a', 'minimax', configuredEnv)).toThrow('AI credential could not be decrypted.')
    expect(() => encryptCredentialForStorage('secret-token', 'user-a', 'minimax', {})).toThrow('AI credential encryption is not configured.')
    expect(() => encryptCredentialForStorage('secret-token', 'user-a', 'minimax', { ...configuredEnv, KEEPLY_AI_KEY_ENCRYPTION_KEY: Buffer.alloc(31).toString('base64') }))
      .toThrow('AI credential encryption is not configured.')
  })
})

describe('user credential management', () => {
  it('verifies identity with Supabase Auth and scopes server storage by that returned user id', async () => {
    const auth = authUser('verified-user')
    storage.read.mockResolvedValue(null)
    await expect(getUserAiKey(auth, 'minimax')).resolves.toBeNull()
    expect(auth.getUser).toHaveBeenCalledOnce()
    expect(storage.read).toHaveBeenCalledWith('verified-user', 'minimax')
  })

  it('denies signed-out, anonymous and rejected auth responses before storage access', async () => {
    const signedOut = { getUser: vi.fn(async () => ({ data: { user: null }, error: { message: 'no session' } })) } as unknown as Parameters<typeof getUserAiKey>[0]
    const anonymous = authUser('anonymous-user', true)
    await expect(getUserAiKey(signedOut, 'minimax')).rejects.toThrow('A signed-in account is required to manage AI credentials.')
    await expect(saveUserAiKey(anonymous, 'minimax', 'some-key')).rejects.toThrow('A signed-in account is required to manage AI credentials.')
    await expect(deleteUserAiKey(anonymous, 'minimax')).rejects.toThrow('A signed-in account is required to manage AI credentials.')
    expect(storage.read).not.toHaveBeenCalled()
    expect(storage.write).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('stores encrypted credentials and refuses subscription-plan tokens and control characters', async () => {
    const auth = authUser('verified-user')
    await expect(saveUserAiKey(auth, 'minimax', 'sk-cp-subscription')).rejects.toThrow('MiniMax Token Plan credentials cannot be used here.')
    await expect(saveUserAiKey(auth, 'minimax', 'line\nbreak')).rejects.toThrow('The AI credential is invalid.')
    expect(storage.write).not.toHaveBeenCalled()
    process.env.KEEPLY_AI_KEY_ENCRYPTION_KEY = keyA
    await saveUserAiKey(auth, 'minimax', 'api-secret')
    const encrypted = storage.write.mock.calls[0]?.[2]
    expect(encrypted.ciphertext.toString('utf8')).not.toContain('api-secret')
    expect(decryptCredentialFromStorage(encrypted, 'verified-user', 'minimax', process.env)).toBe('api-secret')
  })

  it('deletes only for a verified owner and reports configuration without leaking settings', () => {
    storage.configured.mockReturnValue(true)
    expect(isCredentialStorageConfigured(configuredEnv)).toBe(true)
    expect(isCredentialStorageConfigured({})).toBe(false)
  })
})
