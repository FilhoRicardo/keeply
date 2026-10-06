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
      const id = await addAppliance(input)
      router.push(`/appliances/${id}/plan`)
    } catch (err) {
      // KEE-60: a non-dishwasher with no manufacturer manual has no plan to save. The proposer
      // returns [] and the migration refuses empty plans, so we surface the "needs at least one
      // proposed task" message in the form so the owner knows to add a manual or pick a
      // different category. Other failures (network, storage) keep the previous behaviour: the
      // provider's banner in <PlanProvider> shows them and the form is unlocked so the owner can
      // retry.
      const message = err instanceof Error ? err.message : ''
      if (message.includes('at least one proposed task')) {
        setError('No plan could be built. Try entering the manufacturer’s manual, or pick a different appliance.')
      }
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
