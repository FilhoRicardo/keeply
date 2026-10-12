'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePlan } from '../../lib/plan-context'

type KeyStatus = { configured: boolean; available: boolean; provider: 'minimax' }

async function requestStatus(token: string): Promise<KeyStatus> {
  const response = await fetch('/api/ai-key', {
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error('status_unavailable')
  const body = (await response.json()) as Partial<KeyStatus>
  if (body.provider !== 'minimax' || typeof body.configured !== 'boolean' || typeof body.available !== 'boolean') {
    throw new Error('status_unavailable')
  }
  return body as KeyStatus
}

function GoogleMiniMaxKeySettings({ accessToken }: { accessToken: () => Promise<string | null> }) {
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<KeyStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    try {
      const token = await accessToken()
      if (!token) throw new Error('status_unavailable')
      setStatus(await requestStatus(token))
      setProblem(null)
    } catch {
      setProblem('MiniMax settings could not be loaded. Try again.')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    let live = true
    accessToken()
      .catch(() => null)
      .then((token) => (token ? requestStatus(token) : Promise.reject(new Error('status_unavailable'))))
      .then(
        (next) => live && (setStatus(next), setProblem(null)),
        () => live && setProblem('MiniMax settings could not be loaded. Try again.'),
      )
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [accessToken])

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!key.trim()) return
    setBusy(true)
    setProblem(null)
    setMessage(null)
    const submittedKey = key
    try {
      const token = await accessToken()
      if (!token) throw new Error('save_failed')
      const response = await fetch('/api/ai-key', {
        method: 'PUT',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: submittedKey }),
      })
      if (!response.ok) {
        let unsupportedKey = false
        if (response.status === 400) {
          const body = (await response.json().catch(() => null)) as { error?: unknown } | null
          unsupportedKey = body?.error === 'unsupported_key'
        }
        setKey('')
        setProblem(
          unsupportedKey
            ? 'MiniMax Token Plan keys are not supported. Use a MiniMax API key instead.'
            : 'The MiniMax key could not be saved. Check it and try again.',
        )
        return
      }
      setKey('')
      setStatus({ configured: true, available: status?.available ?? false, provider: 'minimax' })
      setMessage('MiniMax key saved. Keeply will not show it again.')
      await loadStatus()
    } catch {
      setKey('')
      setProblem('The MiniMax key could not be saved. Check it and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    setProblem(null)
    setMessage(null)
    setKey('')
    try {
      const token = await accessToken()
      if (!token) throw new Error('remove_failed')
      const response = await fetch('/api/ai-key', {
        method: 'DELETE',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!response.ok) throw new Error('remove_failed')
      setStatus({ configured: false, available: false, provider: 'minimax' })
      setMessage('MiniMax key removed.')
      await loadStatus()
    } catch {
      setProblem('The MiniMax key could not be removed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-stack">
      <section className="aster-glass form-panel" aria-labelledby="minimax-key-title">
        <h2 id="minimax-key-title">Use your MiniMax account</h2>
        <p className="form-intro">
          Add a MiniMax API key to use AI with your provider account. MiniMax bills you directly; Keeply does not pay for these requests.
          Use a permitted API key. MiniMax Token Plan credentials are not supported.
        </p>

        <div className="settings-status aster-inner" aria-live="polite">
          {loading ? (
            <span>Checking MiniMax access…</span>
          ) : !status ? (
            <>
              <strong>MiniMax status unavailable</strong>
              <span>Keeply could not confirm key setup. You can retry or use manual entry.</span>
            </>
          ) : status?.configured ? (
            <>
              <strong>{status.available ? 'Key saved' : 'Key saved; MiniMax access is unavailable'}</strong>
              <span>{status.available ? 'Your key is stored securely and is never shown again.' : 'MiniMax access is not enabled in this Keeply environment. You can still use manual entry.'}</span>
            </>
          ) : status?.available ? (
            <>
              <strong>No MiniMax key saved</strong>
              <span>Manual entry is available without a key.</span>
            </>
          ) : (
            <>
              <strong>MiniMax setup is unavailable</strong>
              <span>MiniMax key setup is not enabled for this Keeply environment. Manual entry is always available.</span>
            </>
          )}
        </div>

        {problem && <p className="form-error" role="alert">{problem}</p>}
        {message && <p className="notice" role="status">{message}</p>}

        {!loading && !status && (
          <button type="button" className="aster-btn aster-btn--ghost full-width" disabled={busy} onClick={loadStatus}>
            Check MiniMax status again
          </button>
        )}

        {status?.available && (
          <form className="settings-key-form" onSubmit={save}>
            <label className="field" htmlFor="minimax-api-key">
              <span>MiniMax API key</span>
              <input
                id="minimax-api-key"
                className="input"
                type="password"
                maxLength={512}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                name="minimax-api-key"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={status.configured ? 'Enter a new key to replace the saved key' : 'Paste your MiniMax API key'}
                disabled={busy}
              />
            </label>
            <button type="submit" className="aster-btn aster-btn--primary full-width" disabled={busy || !key.trim()}>
              {busy ? 'Saving…' : status.configured ? 'Replace key' : 'Save key'}
            </button>
          </form>
        )}

        {status?.configured && (
          <button type="button" className="aster-btn aster-btn--ghost full-width" disabled={busy} onClick={remove}>
            Remove saved key
          </button>
        )}
      </section>

      <section className="settings-notes aster-inner" aria-label="AI access details">
        <h3>Access and usage</h3>
        <p>Anyone signed in with Google can use AI label reading, within a personal daily limit and a shared daily cap. The owner’s scans do not use the shared cap.</p>
        <p>Saving a key does not bypass these limits. If AI is unavailable, you can always enter appliance details manually.</p>
      </section>
    </div>
  )
}

export function MiniMaxKeySettings() {
  const { account, accessToken, signInWithGoogle, switchToGoogleAccount } = usePlan()
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [canSwitch, setCanSwitch] = useState(false)

  async function signIn(switchAccount = false) {
    setBusy(true)
    setProblem(null)
    setCanSwitch(false)
    try {
      const result = switchAccount || account?.kind !== 'anonymous' ? await switchToGoogleAccount() : await signInWithGoogle()
      if (!result.ok) {
        setProblem(result.message)
        setCanSwitch(result.reason === 'already_registered')
      }
    } catch {
      setProblem('Google sign-in could not be started. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!account) {
    return <div className="empty-state aster-inner" aria-busy="true"><p>Checking your Keeply account…</p></div>
  }

  if (account.kind !== 'google') {
    return (
      <section className="aster-glass form-panel" aria-labelledby="account-required-title">
        <h2 id="account-required-title">Sign in to Keeply first</h2>
        <p className="form-intro">
          MiniMax access is saved to your Keeply account. It is separate from Keeply sign-in and does not use your Google account for AI.
        </p>
        {problem && <p className="form-error" role="alert">{problem}</p>}
        <button type="button" className="aster-btn aster-btn--primary full-width" disabled={busy} onClick={() => signIn(canSwitch)}>
          {canSwitch ? 'Switch to that Google account' : 'Sign in with Google'}
        </button>
        <p className="settings-footnote">Manual entry is always available if you do not want to use AI.</p>
      </section>
    )
  }

  // Keying by account makes its in-memory secret and status disappear on sign-out/account changes.
  return <GoogleMiniMaxKeySettings key={account.email ?? 'google'} accessToken={accessToken} />
}
