'use client'

import { useState } from 'react'
import { usePlan } from '../lib/plan-context'

// Home: offer Google sign-in to anonymous visitors so plans survive and follow them; show who is
// signed in otherwise. Not shown in device-only mode.
export function AccountPanel() {
  const { account, signInProblem, signInWithGoogle, switchToGoogleAccount, signOut } = usePlan()
  const [ownProblem, setProblem] = useState<{ message: string; canSwitch: boolean } | null>(null)
  const problem =
    ownProblem ??
    (signInProblem && !signInProblem.ok
      ? { message: signInProblem.message, canSwitch: signInProblem.reason === 'already_registered' }
      : null)
  const [busy, setBusy] = useState(false)
  if (!account || account.kind === 'device') return null

  async function run(action: () => Promise<{ ok: true } | { ok: false; reason: string; message: string }>) {
    setBusy(true)
    let result: { ok: true } | { ok: false; reason: string; message: string }
    try {
      result = await action()
    } catch (e) {
      result = { ok: false, reason: 'failed', message: `Google sign-in did not start: ${e instanceof Error ? e.message : String(e)}` }
    }
    if (!result.ok) {
      setProblem({ message: result.message, canSwitch: result.reason === 'already_registered' })
      setBusy(false)
    }
    // On success the browser is on its way to Google.
  }

  if (account.kind === 'google') {
    return (
      <p className="calendar-status account-line">
        Signed in{account.email ? ` as ${account.email}` : ''}.{' '}
        <button type="button" className="link-button" onClick={() => signOut()}>
          Sign out
        </button>
      </p>
    )
  }

  return (
    <section className="calendar-panel aster-inner import-banner" aria-label="Your account">
      <p>Your plans are kept in this browser only. Sign in with Google to keep them safe and use them on other devices.</p>
      {problem && (
        <p className="form-error" role="alert">
          {problem.message}
        </p>
      )}
      {problem?.canSwitch ? (
        <button type="button" className="aster-btn aster-btn--ghost full-width" disabled={busy} onClick={() => run(switchToGoogleAccount)}>
          Switch to that account
        </button>
      ) : (
        <button type="button" className="aster-btn aster-btn--ghost full-width" disabled={busy} onClick={() => run(signInWithGoogle)}>
          Sign in with Google
        </button>
      )}
    </section>
  )
}
