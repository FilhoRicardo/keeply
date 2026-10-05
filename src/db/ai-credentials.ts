import 'server-only'
import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

// BYO AI credentials are only accessible to server code. The table has no user-facing grants;
// every operation below uses a separately configured service-role client and an independently
// verified auth.users id supplied by src/ai/credentials.ts.

export type AiCredentialProvider = 'minimax'

export type EncryptedAiCredential = {
  ciphertext: Buffer
  nonce: Buffer
  authTag: Buffer
}

type CredentialRow = {
  ciphertext: string
  nonce: string
  auth_tag: string
}

function serviceClient(env: Record<string, string | undefined> = process.env): SupabaseClient {
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('AI credential storage is not configured.')

  try {
    return createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  } catch {
    throw new Error('AI credential storage is not configured.')
  }
}

export function isAiCredentialStorageConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY)
}

function fromRow(row: CredentialRow | null): EncryptedAiCredential | null {
  if (!row) return null
  try {
    return {
      ciphertext: Buffer.from(row.ciphertext, 'base64'),
      nonce: Buffer.from(row.nonce, 'base64'),
      authTag: Buffer.from(row.auth_tag, 'base64'),
    }
  } catch {
    throw new Error('AI credential storage failed.')
  }
}

function toRow(value: EncryptedAiCredential) {
  return {
    ciphertext: value.ciphertext.toString('base64'),
    nonce: value.nonce.toString('base64'),
    auth_tag: value.authTag.toString('base64'),
  }
}

export async function readEncryptedAiCredential(
  userId: string,
  provider: AiCredentialProvider,
): Promise<EncryptedAiCredential | null> {
  const { data, error } = await serviceClient()
    .from('ai_credentials')
    .select('ciphertext, nonce, auth_tag')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  if (error) throw new Error('AI credential storage failed.')
  return fromRow(data as CredentialRow | null)
}

export async function writeEncryptedAiCredential(
  userId: string,
  provider: AiCredentialProvider,
  value: EncryptedAiCredential,
): Promise<void> {
  const { error } = await serviceClient()
    .from('ai_credentials')
    .upsert({ user_id: userId, provider, ...toRow(value) }, { onConflict: 'user_id,provider' })
  if (error) throw new Error('AI credential storage failed.')
}

export async function removeEncryptedAiCredential(
  userId: string,
  provider: AiCredentialProvider,
): Promise<void> {
  const { error } = await serviceClient()
    .from('ai_credentials')
    .delete()
    .eq('user_id', userId)
    .eq('provider', provider)
  if (error) throw new Error('AI credential storage failed.')
}
