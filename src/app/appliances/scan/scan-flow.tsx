'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useId, useState } from 'react'
import {
  editIdentification,
  emptyIdentification,
  validateIdentification,
  type ApplianceIdentification,
  type ApplianceRecognizer,
  type RecognitionResult,
} from '@/domain/identification'
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
    }

// Defaults to the server's recogniser (/api/identify): the configured AI provider, or Manual.
export function ScanFlow({ recognizer = httpRecognizer }: { recognizer?: ApplianceRecognizer }) {
  const id = useId()
  const router = useRouter()
  const { addAppliance } = usePlan()
  const [step, setStep] = useState<Step>({ kind: 'capture' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const preview = step.kind === 'capture' ? null : step.preview
  // Release the preview's object URL when the photo changes or the screen closes.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function onPhoto(file: File | undefined) {
    if (!file) return
    setError(null)
    const prepared = await prepareLabelPhoto(file)
    const preview = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(prepared) : null
    setStep({ kind: 'reading', photo: prepared, preview })
    // Only a photo re-encoded in the browser (EXIF/GPS dropped) may go to an AI service; if the
    // browser could not decode it, the owner types the details instead.
    const reencoded = prepared !== file
    // An "other" or unreadable answer is too uncertain to claim anything; both get the same neutral message.
    const { identification: proposal } = reencoded
      ? await recognizer.recognise(prepared).catch((): RecognitionResult => ({ identification: null, notice: null }))
      : { identification: null }
    setStep({
      kind: 'confirm',
      photo: prepared,
      preview,
      identification: proposal ?? emptyIdentification(),
      recognised: proposal !== null,
      editing: proposal === null,
    })
  }

  if (step.kind === 'capture') {
    return (
      <section className="aster-glass form-panel" aria-label="Photograph the label">
        <p className="form-intro">
          Open the dishwasher door and photograph the label on the edge of the door or inside the tub. It shows the
          manufacturer and model number. Keeply may send the photo to an AI service to suggest the details; you
          always confirm them.
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

  const { identification, recognised, editing } = step
  // Typing answers any earlier "enter the manufacturer" error, so it no longer applies.
  const set = (change: Partial<Pick<ApplianceIdentification, 'manufacturer' | 'model' | 'serialNumber'>>) => {
    setError(null)
    setStep({ ...step, identification: editIdentification(identification, change) })
  }

  async function confirm() {
    const problem = validateIdentification(identification)
    if (problem) return setError(problem)
    setBusy(true)
    try {
      const applianceId = await addAppliance({
        manufacturer: identification.manufacturer,
        model: identification.model,
        serialNumber: identification.serialNumber,
        photo: step.kind === 'confirm' ? step.photo : null,
        confidence: identification.confidence,
      })
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
              <dd>Dishwasher</dd>
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
          <p className="form-intro">Read from your photo. Check it against the label: is this correct?</p>
        </>
      ) : (
        <>
          {!recognised && (
            <p className="form-intro">
              Keeply could not read a dishwasher label in this photo. Try a clearer photo of the label, or enter the
              details below.
            </p>
          )}
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
