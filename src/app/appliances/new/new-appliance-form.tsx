'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { usePlan } from '../../lib/plan-context'
import { validateNewAppliance, type NewApplianceInput } from '../../lib/plan-state'

export function NewApplianceForm() {
  const router = useRouter()
  const { addAppliance } = usePlan()
  const [input, setInput] = useState<NewApplianceInput>({ manufacturer: '', model: '', serialNumber: '' })
  const [error, setError] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    const problem = validateNewAppliance(input)
    if (problem) return setError(problem)
    setBusy(true)
    const id = await addAppliance(input)
    router.push(`/appliances/${id}/plan`)
  }

  const field = (key: keyof NewApplianceInput) => ({
    value: input[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setInput((i) => ({ ...i, [key]: e.target.value })),
  })

  return (
    <form className="aster-glass form-panel" onSubmit={submit} noValidate>
      <p className="form-intro">
        Type what is on the label inside the door. The model number gives the best guidance later; you can leave it
        blank.
      </p>

      <label className="field">
        <span>Appliance</span>
        <input className="input" value="Dishwasher" readOnly aria-readonly="true" />
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

      <button type="submit" className="aster-btn aster-btn--primary full-width" disabled={busy}>
        Continue to maintenance plan
      </button>
    </form>
  )
}
