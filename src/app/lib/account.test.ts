// @vitest-environment jsdom
import type { SupabaseClient, User } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { accountFromUser, supabaseAccount, takeRedirectProblem } from './account'

const user = (overrides: Partial<User>) => ({ id: 'u', is_anonymous: false, user_metadata: {}, ...overrides }) as User

function fakeDb({ anonymous = true, linkError = null as string | null } = {}) {
  const auth = {
    getSession: vi.fn(async () => ({ data: { session: { user: user({ is_anonymous: anonymous }) } } })),
    linkIdentity: vi.fn(async () => ({ data: {}, error: linkError ? { message: linkError } : null })),
    signInWithOAuth: vi.fn(async () => ({ data: {}, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  }
  return { db: { auth } as unknown as SupabaseClient, auth }
}

describe('accountFromUser', () => {
  it('reads anonymous and Google accounts', () => {
    expect(accountFromUser(null)).toEqual({ kind: 'anonymous' })
    expect(accountFromUser(user({ is_anonymous: true }))).toEqual({ kind: 'anonymous' })
    expect(accountFromUser(user({ email: 'r@example.com', user_metadata: { full_name: 'Ricardo' } }))).toEqual({
      kind: 'google',
      email: 'r@example.com',
      name: 'Ricardo',
    })
  })
})

describe('supabaseAccount', () => {
  it('links Google to the anonymous account so its plans are kept', async () => {
    const { db, auth } = fakeDb()
    expect(await supabaseAccount(db).signInWithGoogle()).toEqual({ ok: true })
    expect(auth.linkIdentity).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }))
    expect(auth.signInWithOAuth).not.toHaveBeenCalled()
  })

  it('explains when that Google login already has a Keeply account', async () => {
    const { db } = fakeDb({ linkError: 'Identity is already linked to another user' })
    const result = await supabaseAccount(db).signInWithGoogle()
    expect(result).toMatchObject({ ok: false, reason: 'already_registered' })
  })

  it('uses a plain Google sign-in when there is no anonymous session', async () => {
    const { db, auth } = fakeDb({ anonymous: false })
    await supabaseAccount(db).signInWithGoogle()
    expect(auth.signInWithOAuth).toHaveBeenCalledWith(expect.objectContaining({ provider: 'google' }))
    expect(auth.linkIdentity).not.toHaveBeenCalled()
  })
})

describe('takeRedirectProblem', () => {
  it('reports a Google login that already has Keeply and tidies the URL', () => {
    window.history.replaceState(null, '', '/?keep=1#error=server_error&error_code=identity_already_exists&error_description=Identity+is+already+linked')
    expect(takeRedirectProblem()).toMatchObject({ ok: false, reason: 'already_registered' })
    expect(window.location.search).toBe('?keep=1')
    expect(window.location.hash).toBe('')
    expect(takeRedirectProblem()).toBeNull()
  })

  it('reports other callback errors as failures', () => {
    window.history.replaceState(null, '', '/?error=access_denied&error_description=User+cancelled')
    expect(takeRedirectProblem()).toMatchObject({ ok: false, reason: 'failed', message: expect.stringMatching(/User cancelled/) })
    expect(window.location.search).toBe('')
  })
})
