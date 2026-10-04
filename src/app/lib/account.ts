import type { SupabaseClient, User } from '@supabase/supabase-js'

export type Account =
  | { kind: 'device' } // no Supabase: plans live in this browser only
  | { kind: 'anonymous' } // Supabase session without a login: lost if the browser is cleared
  | { kind: 'google'; email: string | null; name: string | null }

export type SignInResult = { ok: true } | { ok: false; reason: 'already_registered' | 'failed'; message: string }

// Who the visitor is, and how they sign in. Separate from Google Calendar access, which is its
// own narrower consent (calendar.events) handled by /auth/google.
export interface AccountService {
  current(): Promise<Account>
  onChange(listener: () => void): () => void
  // Links Google to the current anonymous account, keeping its plans. Redirects to Google.
  signInWithGoogle(): Promise<SignInResult>
  // Switches to an existing Keeply account for that Google login (anonymous plans stay behind).
  switchToGoogleAccount(): Promise<SignInResult>
  // Signs out; a fresh anonymous session starts on the next plan action.
  signOut(): Promise<void>
  // A sign-in that failed on the way back from Google (the error arrives in the redirect URL,
  // e.g. when that Google login already belongs to another Keeply account). Read once.
  redirectProblem?(): Promise<SignInResult | null>
}

export const deviceAccount: AccountService = {
  current: async () => ({ kind: 'device' }),
  onChange: () => () => {},
  signInWithGoogle: async () => ({ ok: false, reason: 'failed', message: 'Sign-in needs Keeply’s online storage.' }),
  switchToGoogleAccount: async () => ({ ok: false, reason: 'failed', message: 'Sign-in needs Keeply’s online storage.' }),
  signOut: async () => {},
}

export function accountFromUser(user: User | null | undefined): Account {
  if (!user || user.is_anonymous) return { kind: 'anonymous' }
  const meta = (user.user_metadata ?? {}) as { full_name?: string; name?: string }
  return { kind: 'google', email: user.email ?? null, name: meta.full_name ?? meta.name ?? null }
}

const ALREADY_REGISTERED =
  'That Google account already has Keeply plans. Switch to it? What you saved here without signing in stays on this browser’s old session.'

// Reads (and removes) an OAuth error that Supabase put in the callback URL's query or hash.
export function takeRedirectProblem(): SignInResult | null {
  if (typeof window === 'undefined') return null
  const url = new URL(window.location.href)
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''))
  const read = (key: string) => url.searchParams.get(key) ?? hash.get(key)
  const code = read('error_code')
  const description = read('error_description')
  if (!code && !description && !read('error')) return null
  for (const key of ['error', 'error_code', 'error_description']) {
    url.searchParams.delete(key)
    hash.delete(key)
  }
  const rest = hash.toString()
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${rest ? `#${rest}` : ''}`)
  return code === 'identity_already_exists'
    ? { ok: false, reason: 'already_registered', message: ALREADY_REGISTERED }
    : { ok: false, reason: 'failed', message: `Google sign-in did not finish: ${description ?? code ?? 'unknown error'}` }
}

function redirectTo(): string | undefined {
  return typeof window === 'undefined' ? undefined : `${window.location.origin}/`
}

export function supabaseAccount(db: SupabaseClient): AccountService {
  return {
    async current() {
      const { data } = await db.auth.getSession()
      return accountFromUser(data.session?.user)
    },
    onChange(listener) {
      const { data } = db.auth.onAuthStateChange(() => listener())
      return () => data.subscription.unsubscribe()
    },
    async signInWithGoogle() {
      const { data } = await db.auth.getSession()
      // No session yet, or already a full account: plain sign-in.
      if (!data.session?.user.is_anonymous) return this.switchToGoogleAccount()
      const { error } = await db.auth.linkIdentity({ provider: 'google', options: { redirectTo: redirectTo() } })
      if (!error) return { ok: true }
      const taken = /already|exists|linked/i.test(error.message)
      return {
        ok: false,
        reason: taken ? 'already_registered' : 'failed',
        message: taken ? ALREADY_REGISTERED : `Google sign-in did not start: ${error.message}`,
      }
    },
    async switchToGoogleAccount() {
      const { error } = await db.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectTo() } })
      return error ? { ok: false, reason: 'failed', message: `Google sign-in did not start: ${error.message}` } : { ok: true }
    },
    async signOut() {
      await db.auth.signOut()
    },
    async redirectProblem() {
      // getSession waits for auth-js to finish reading the callback URL before we tidy it.
      await db.auth.getSession()
      return takeRedirectProblem()
    },
  }
}
