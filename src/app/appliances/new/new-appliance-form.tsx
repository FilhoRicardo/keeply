'use client'

import { useRouter } from 'next/navigation'
import { useId, useState } from 'react'
import { usePlan } from '../../lib/plan-context'
import { validateNewAppliance, type NewApplianceInput } from '../../lib/plan-state'

// Adds a confirmed appliance. KEE-60: any household appliance, not only dishwashers. The category
// field defaults to "Dishwasher" (the pre-KEE-60 default) so the existing dishwasher flow keeps
// working, but the owner can change it to anything (Fridge, Washing machine, etc.). While the
// live search (KEE-42 /api/plan) is in flight the form shows a "looking for your manual"
// progress message so the owner is not staring at a button that may take ~25 s to respond.
export function NewApplianceForm() {
  const router = useRouter()
  const id = useId()
  const { addAppliance } = usePlan()
  const [input, setInput] = useState<NewApplianceInput>({ category: 'Dishwasher', manufacturer: '', model: '', serialNumber: '' })
  const [error, setError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = validateNewAppliance(input)
    if (problem) return setError(problem)
    setBusy(true)
    setError(null)
    try {
      // KEE-60: the proposer can honestly return no plan for a non-dishwasher with no manual.
      // The context returns a typed `no_plan` result (not a throw) so the provider's error
      // banner — which is reserved for network and storage failures — is not triggered.
      const result = await addAppliance(input)
      if (result.kind === 'no_plan') {
        setError('No plan could be built for this appliance. Try a different category, or look up the manufacturer’s manual online.')
        setBusy(false)
        return
      }
      router.push(`/appliances/${result.applianceId}/plan`)
    } catch {
      // A throw here is a real failure (network, storage, validation): the provider's banner
      // is already showing it. Just unlock the form so the owner can retry.
      setBusy(false)
    }
  }

  const field = (key: 'category' | 'manufacturer' | 'model' | 'serialNumber') => ({
    value: input[key] ?? '',
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInput((i) => ({ ...i, [key]: e.target.value })),
  })

  return (
    <form className="aster-glass form-panel" onSubmit={submit} noValidate>
      <p className="form-intro">
        Type what is on the label inside the door. The model number gives the best guidance later; you can leave it
        blank.
      </p>

      <label className="field">
        <span>
          Appliance <small>(for example Dishwasher or Fridge)</small>
        </span>
        <input
          id={`${id}-category`}
          className="input"
          autoComplete="off"
          {...field('category')}
        />
      </label>
      <label className="field">
        <span>Manufacturer</span>
        <input
          className="input"
          autoComplete="off"
          placeholder="e.g. Bosch"
          aria-invalid={error ? true : undefined}
          {...field('manufacturer')}
        />
      </label>
      <label className="field">
        <span>
          Model number <small>(optional)</small>
        </span>
        <input className="input" autoComplete="off" placeholder="e.g. SMS6ZCI49E" {...field('model')} />
      </label>
      <label className="field">
        <span>
          Serial number <small>(optional)</small>
        </span>
        <input className="input" autoComplete="off" {...field('serialNumber')} />
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {busy && (
        <p className="form-progress" role="status" aria-live="polite" data-testid="form-progress">
          Looking for your manual…
        </p>
      )}

      <button type="submit" className="aster-btn aster-btn--primary full-width" disabled={busy}>
        {busy ? 'Looking for your manual…' : 'Continue to maintenance plan'}
      </button>
    </form>
  )
}
