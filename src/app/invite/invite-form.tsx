'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useState } from 'react'
import type { RedeemResponse } from '../api/scan-access/route'
import { usePlan } from '../lib/plan-context'
import { scanEnabled } from '../lib/features'

const RESULT_COPY: Record<RedeemResponse['result'], string> = {
  invited: 'Invite accepted. AI label reading is on for your Keeply account.',
  already_invited: 'Your Keeply account already has an invite.',
  invalid: 'That code is not valid or has already been used. Check it, or ask for a new one.',
  signed_out: 'Keeply could not start your session. Reload the page and try again.',
  unavailable: 'Invites are not available right now. Try again later.',
}

// Accepts a tester invite for this browser's Keeply account. Signing in with Google keeps the
// account (and its invite) across browsers and devices.
export function InviteForm() {
  const { accessToken, account, track } = usePlan()
  const linked = useSearchParams().get('code') ?? ''
  const [code, setCode] = useState(linked)
  const [result, setResult] = useState<RedeemResponse['result'] | null>(null)
  const [busy, setBusy] = useState(false)

  async function accept(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    try {
      const token = await accessToken().catch(() => null)
      const response = await fetch('/api/scan-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ code }),
      })
      const { result: outcome } = (await response.json().catch(() => ({ result: 'unavailable' }))) as RedeemResponse
      setResult(outcome)
      if (outcome === 'invited') track({ name: 'invite_redeemed' })
    } catch {
      setResult('unavailable')
    } finally {
      setBusy(false)
    }
  }

  const done = result === 'invited' || result === 'already_invited'
  return (
    <form className="aster-glass form-panel" onSubmit={accept} noValidate>
      <p className="form-intro">
        Keeply can read your appliance’s label from a photo. During testing this is for invited testers, with a few AI
        scans per day. You can always type the details instead.
      </p>
      {account?.kind === 'anonymous' && (
        <p className="form-intro">
          Tip: sign in with Google on the Home screen first, so your invite stays with you on other devices.
        </p>
      )}
      <label className="field">
        <span>Invite code</span>
        <input
          className="input"
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="KP-XXXX-XXXX-XXXX-XXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      {result && (
        <p className={done ? 'notice' : 'form-error'} role={done ? 'status' : 'alert'}>
          {RESULT_COPY[result]}
        </p>
      )}
      {done ? (
        scanEnabled() ? (
          <Link className="aster-btn aster-btn--primary full-width" href="/appliances/scan">
            Scan an appliance
          </Link>
        ) : (
          <p className="form-intro">AI label reading is not switched on yet. Your invite is saved for when it is.</p>
        )
      ) : (
        <button type="submit" className="aster-btn aster-btn--primary full-width" disabled={busy || code.trim().length < 4}>
          {busy ? 'Checking…' : 'Accept invite'}
        </button>
      )}
    </form>
  )
}
