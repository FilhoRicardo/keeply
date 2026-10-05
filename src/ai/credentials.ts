import 'server-only'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  readEncryptedAiCredential,
  removeEncryptedAiCredential,
  writeEncryptedAiCredential,
  isAiCredentialStorageConfigured,
  type AiCredentialProvider,
  type EncryptedAiCredential,
} from '@/db/ai-credentials'

const KEY_ENV = 'KEEPLY_AI_KEY_ENCRYPTION_KEY'
const KEY_BYTES = 32
const NONCE_BYTES = 12
const TAG_BYTES = 16
const MAX_KEY_LENGTH = 4096

type UserAuth = Pick<SupabaseClient['auth'], 'getUser'>

function encryptionKey(env: Record<string, string | undefined> = process.env): Buffer {
  const encoded = env[KEY_ENV]
  if (!encoded || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    throw new Error('AI credential encryption is not configured.')
  }
  const key = Buffer.from(encoded, 'base64')
  if (key.length !== KEY_BYTES || key.toString('base64') !== encoded) {
    throw new Error('AI credential encryption is not configured.')
  }
  return key
}

function aad(userId: string, provider: AiCredentialProvider): Buffer {
  return Buffer.from(`keeply-ai-credential\0${userId}\0${provider}`, 'utf8')
}

export function encryptCredentialForStorage(
  plaintext: string,
  userId: string,
  provider: AiCredentialProvider,
  env: Record<string, string | undefined> = process.env,
): EncryptedAiCredential {
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(aad(userId, provider))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { ciphertext, nonce, authTag: cipher.getAuthTag() }
}

export function decryptCredentialFromStorage(
  encrypted: EncryptedAiCredential,
  userId: string,
  provider: AiCredentialProvider,
  env: Record<string, string | undefined> = process.env,
): string {
  try {
    if (encrypted.nonce.length !== NONCE_BYTES || encrypted.authTag.length !== TAG_BYTES) throw new Error()
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), encrypted.nonce, { authTagLength: TAG_BYTES })
    decipher.setAAD(aad(userId, provider))
    decipher.setAuthTag(encrypted.authTag)
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString('utf8')
  } catch {
    // Never include provider response details, ciphertext, or key material in an error.
    throw new Error('AI credential could not be decrypted.')
  }
}

async function authenticatedUserId(auth: UserAuth): Promise<string> {
  let result: Awaited<ReturnType<UserAuth['getUser']>>
  try {
    result = await auth.getUser()
  } catch {
    throw new Error('A signed-in account is required to manage AI credentials.')
  }
  const user = result.data.user
  if (result.error || !user || user.is_anonymous) {
    throw new Error('A signed-in account is required to manage AI credentials.')
  }
  return user.id
}

function validateCredential(provider: AiCredentialProvider, credential: string): void {
  if (typeof credential !== 'string' || credential.length === 0 || credential.length > MAX_KEY_LENGTH || credential.trim() !== credential || /\s|[\u0000-\u001f\u007f]/.test(credential)) {
    throw new Error('The AI credential is invalid.')
  }
  // MiniMax Token Plan subscription tokens (sk-cp-...) are not API credentials for this hosted
  // product flow. This explicit rejection does not claim that every other token format is valid.
  if (provider === 'minimax' && credential.startsWith('sk-cp-')) {
    throw new Error('MiniMax Token Plan credentials cannot be used here.')
  }
}

export function isCredentialStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  try {
    encryptionKey(env)
    return isAiCredentialStorageConfigured(env)
  } catch {
    return false
  }
}

export async function getUserAiKey(auth: UserAuth, provider: AiCredentialProvider): Promise<string | null> {
  const userId = await authenticatedUserId(auth)
  const encrypted = await readEncryptedAiCredential(userId, provider)
  return encrypted ? decryptCredentialFromStorage(encrypted, userId, provider) : null
}

export async function saveUserAiKey(
  auth: UserAuth,
  provider: AiCredentialProvider,
  credential: string,
): Promise<void> {
  const userId = await authenticatedUserId(auth)
  validateCredential(provider, credential)
  const encrypted = encryptCredentialForStorage(credential, userId, provider)
  await writeEncryptedAiCredential(userId, provider, encrypted)
}

export async function deleteUserAiKey(auth: UserAuth, provider: AiCredentialProvider): Promise<void> {
  const userId = await authenticatedUserId(auth)
  await removeEncryptedAiCredential(userId, provider)
}
