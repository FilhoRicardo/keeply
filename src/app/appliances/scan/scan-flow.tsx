'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useId, useMemo, useState } from 'react'
import {
  editIdentification,
  emptyIdentification,
  isAccessDenial,
  validateIdentification,
  type ApplianceIdentification,
  type ApplianceRecognizer,
  type AccessDenial,
  type RecognitionNotice,
  type RecognitionResult,
} from '@/domain/identification'
import type { ScanAccess } from '../../api/scan-access/route'
import { httpRecognizer } from '../../lib/identify'
import { usePlan } from '../../lib/plan-context'
import { prepareLabelPhoto } from '../../lib/photo'

type Step =
  | { kind: 'capture' }
  | { kind: 'reading'; photo: Blob; preview: string | null }
  | {
      kind: 'confirm'
      photo: Blob
      preview: string | null
      identification: ApplianceIdentification
      recognised: boolean
      editing: boolean
      notice: RecognitionNotice | null
    }

// Why the owner is typing instead of confirming a proposal.
type ManualReasonKey = 'unread' | 'no_invite' | 'tester_limit' | 'daily_limit' | 'ai_unavailable'

const UNREAD =
  'Keeply could not read an appliance label in this photo. Try a clearer photo of the label, or enter the details below.'

const MANUAL_REASON: Record<ManualReasonKey, string> = {
  unread: UNREAD,
  no_invite: 'AI label reading is for invited testers, so the photo was not sent to the AI service. Enter the details below.',
  tester_limit: 'You have used today’s AI scans, so the photo was not sent to the AI service. Enter the details below, or scan again tomorrow.',
  daily_limit: 'Keeply has reached today’s AI scan limit, so the photo was not sent to the AI service. Enter the details below, or scan again tomorrow.',
  ai_unavailable: 'AI label reading is not available right now, so the photo was not sent to the AI service. Enter the details below.',
}

function manualReasonFor(notice: RecognitionNotice | null): string {
  // KEE-60: only access refusals come through here; an "other" appliance is no longer a refusal.
  if (notice && (MANUAL_REASON as Record<string, string>)[notice]) return MANUAL_REASON[notice as ManualReasonKey]
  return UNREAD
}

// KEE-60: capitalise the appliance category for display ("dishwasher" → "Dishwasher"). Falls back
// to "Appliance" when the model did not recognise one.
function displayCategory(category: string): string {
  const trimmed = category.trim()
  if (!trimmed) return 'Appliance'
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

// What AI reading the visitor can expect, from /api/scan-access. Refreshed when the account changes.
function useScanAccess(accessToken: () => Promise<string | null>, accountKey: string): ScanAccess | null {
  const [access, setAccess] = useState<ScanAccess | null>(null)
  useEffect(() => {
    let live = true
    accessToken()
      .catch(() => null)
      .then((token) => fetch('/api/scan-access', { cache: 'no-store', headers: token ? { Authorization: `Bearer ${token}` } : {} }))
      .then((r) => (r.ok ? (r.json() as Promise<ScanAccess>) : null))
      .then((a) => live && setAccess(a), () => {})
    return () => {
      live = false
    }
  }, [accessToken, accountKey])
  return access
}

// A refusal already known before the photo is taken, so the photo is not uploaded at all.
function knownDenial(access: ScanAccess | null): AccessDenial | null {
  if (!access?.ai) return null
  if (access.access === 'no_invite') return 'no_invite'
  if (access.access === 'invited' && access.testerLeft <= 0) return 'tester_limit'
  if (access.access === 'invited' && access.globalLeft <= 0) return 'daily_limit'
  return null
}

function ScanAccessNote({ access }: { access: ScanAccess | null }) {
  if (!access?.ai) return null
  if (access.access === 'invited') {
    const left = Math.min(access.testerLeft, access.globalLeft)
    return (
      <p className="notice" role="status">
        {left > 0 ? `AI label reading: ${left} ${left === 1 ? 'scan' : 'scans'} left today.` : 'No AI scans left today. You can still type the details.'}
      </p>
    )
  }
  if (access.access === 'no_invite') {
    return (
      <p className="notice notice--warning" role="status">
        AI label reading is for invited testers. <Link href="/invite">Have an invite code?</Link> You can still take a photo
        and type the details.
      </p>
    )
  }
  return null
}

// Defaults to the server's recogniser (/api/identify): the configured AI provider, or Manual.
export function ScanFlow({ recognizer: injected }: { recognizer?: ApplianceRecognizer }) {
  const id = useId()
  const router = useRouter()
  const { addAppliance, track, accessToken, account } = usePlan()
  const recognizer = useMemo(() => injected ?? httpRecognizer(accessToken), [injected, accessToken])
  const access = useScanAccess(accessToken, account ? JSON.stringify(account) : '')
  const [step, setStep] = useState<Step>({ kind: 'capture' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = step.kind === 'capture' ? null : step.preview
  // Release the preview's object URL when the photo changes or the screen closes.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setError(null)
    track({ name: 'scan_started' })
    const prepared = await prepareLabelPhoto(file)
    const preview = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(prepared) : null
    setStep({ kind: 'reading', photo: prepared, preview })
    // Only a photo re-encoded in the browser (EXIF/GPS dropped) may go to an AI service; if the
    // browser could not decode it, the owner types the details instead.
    const reencoded = prepared !== file
    // An "other" or unreadable answer is too uncertain to claim anything; both get the same neutral message.
    const denied = knownDenial(access)
    const { identification: proposal, notice }: RecognitionResult = denied
      ? { identification: null, notice: denied }
      : reencoded
        ? await recognizer.recognise(prepared).catch((): RecognitionResult => ({ identification: null, notice: null }))
        : { identification: null, notice: null }
    if (isAccessDenial(notice)) {
      track({ name: 'scan_denied', reason: notice })
    } else {
      track({ name: 'label_read', recognised: proposal !== null })
    }
    setStep({
      kind: 'confirm',
      photo: prepared,
      preview,
      identification: proposal ?? emptyIdentification(),
      recognised: proposal !== null,
      editing: proposal === null,
      notice,
    })
  }

  if (step.kind === 'capture') {
    return (
      <section className="aster-glass form-panel" aria-label="Photograph the label">
        <ScanAccessNote access={access} />
        <p className="form-intro">
          Open the appliance door (or panel) and photograph the rating label. It shows the manufacturer
          and model number. Keeply may send the photo to an AI service to suggest the details, and does not keep it; you
          always confirm them.
        </p>
        <p className="settings-footnote">
          AI scans require an invite and daily limits apply. You can manage your MiniMax key in{' '}
          <Link href="/settings/ai">AI settings</Link>.
        </p>
        <label className="aster-btn aster-btn--primary full-width file-button">
          Take or choose a photo
          <input
            className="visually-hidden"
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => onPhoto(e.target.files?.[0])}
          />
        </label>
      </section>
    )
  }

  if (step.kind === 'reading') {
    return (
      <div className="empty-state aster-inner" aria-busy="true">
        <p>Reading the label…</p>
      </div>
    )
  }

  const { identification, recognised, editing, notice } = step
  // Typing answers any earlier "enter the manufacturer" error, so it no longer applies.
  const set = (change: Partial<Pick<ApplianceIdentification, 'category' | 'manufacturer' | 'model' | 'serialNumber'>>) => {
    setError(null)
    setStep({ ...step, identification: editIdentification(identification, change) })
  }

  async function confirm() {
    const problem = validateIdentification(identification)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const applianceId = await addAppliance(
        {
          category: identification.category,
          manufacturer: identification.manufacturer,
          model: identification.model,
          serialNumber: identification.serialNumber,
          confidence: identification.confidence,
        },
        true,
      )
      router.push(`/appliances/${applianceId}/plan`)
    } catch {
      setBusy(false)
    }
  }

  return (
    <section className="aster-glass form-panel" aria-label="Confirm identification">
      {preview && (
        // blob: preview of an unsaved photo; next/image cannot optimise it.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="label-photo" src={preview} alt="Your photo of the label" />
      )}

      {recognised && !editing ? (
        <>
          <dl className="identity">
            <div>
              <dt>Appliance</dt>
              {/* KEE-60: the model reads any household appliance; show what it recognised, capitalised. */}
              <dd>{displayCategory(identification.category)}</dd>
            </div>
            <div>
              <dt>Manufacturer</dt>
              <dd>{identification.manufacturer}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{identification.model || 'Not read'}</dd>
            </div>
            {/* Confirm saves the serial too, so the owner must see it before approving. */}
            {identification.serialNumber && (
              <div>
                <dt>Serial number</dt>
                <dd>{identification.serialNumber}</dd>
              </div>
            )}
          </dl>
          <p className="form-intro">
            Read from your photo. Check it against the label: is this correct? Compare the model number
            character by character; look-alikes such as V and Y or 0 and O are the most common misreads.
          </p>
        </>
      ) : (
        <>
          {!recognised && <p className="form-intro">{manualReasonFor(notice)}</p>}
          <label className="field">
            <span>
              Appliance <small>(for example Dishwasher or Fridge)</small>
            </span>
            <input
              id={`${id}-category`}
              className="input"
              autoComplete="off"
              value={identification.category}
              onChange={(e) => set({ category: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Manufacturer</span>
            <input
              id={`${id}-manufacturer`}
              className="input"
              autoComplete="off"
              value={identification.manufacturer}
              onChange={(e) => set({ manufacturer: e.target.value })}
            />
          </label>
          <label className="field">
            <span>
              Model number <small>(optional)</small>
            </span>
            <input className="input" autoComplete="off" value={identification.model} onChange={(e) => set({ model: e.target.value })} />
          </label>
          <label className="field">
            <span>
              Serial number <small>(optional)</small>
            </span>
            <input
              className="input"
              autoComplete="off"
              value={identification.serialNumber}
              onChange={(e) => set({ serialNumber: e.target.value })}
            />
          </label>
        </>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <button type="button" className="aster-btn aster-btn--primary full-width" onClick={confirm} disabled={busy}>
        Confirm
      </button>
      <div className="button-row">
        {recognised && !editing && (
          <button type="button" className="aster-btn aster-btn--ghost" onClick={() => setStep({ ...step, editing: true })}>
            Edit
          </button>
        )}
        <button type="button" className="aster-btn aster-btn--ghost" onClick={() => setStep({ kind: 'capture' })}>
          Rescan
        </button>
      </div>
    </section>
  )
}
