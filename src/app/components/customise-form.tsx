'use client'

import { useId, useState } from 'react'
import type { IntervalUnit } from '@/domain/format-interval'
import type { SchedulingMode } from '@/domain/model'
import { validateCustomisation, type Customisation } from '@/domain/plan'

const UNITS: IntervalUnit[] = ['day', 'week', 'month', 'year']

export function CustomiseForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Customisation
  onSave: (customisation: Customisation) => void
  onCancel: () => void
}) {
  const id = useId()
  const [count, setCount] = useState(String(initial.interval.count))
  const [unit, setUnit] = useState<IntervalUnit>(initial.interval.unit)
  const [startDate, setStartDate] = useState(initial.startDate)
  const [mode, setMode] = useState<SchedulingMode>(initial.schedulingMode)
  const [error, setError] = useState<string | null>(null)

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const customisation: Customisation = {
      interval: { count: Number(count), unit },
      startDate,
      schedulingMode: mode,
    }
    const problem = validateCustomisation(customisation)
    if (problem) return setError(problem)
    onSave(customisation)
  }

  return (
    <form className="customise-form" onSubmit={submit} aria-label="Customise task" noValidate>
      <fieldset className="field-row">
        <legend>Your frequency</legend>
        <span className="field-prefix">Every</span>
        <label className="visually-hidden" htmlFor={`${id}-count`}>
          Number
        </label>
        <input
          id={`${id}-count`}
          className="input input--count"
          type="number"
          inputMode="numeric"
          min={1}
          max={999}
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
        <label className="visually-hidden" htmlFor={`${id}-unit`}>
          Unit
        </label>
        <select id={`${id}-unit`} className="input" value={unit} onChange={(e) => setUnit(e.target.value as IntervalUnit)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}s
            </option>
          ))}
        </select>
      </fieldset>

      <label className="field">
        <span>Start date</span>
        <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
      </label>

      <fieldset className="field">
        <legend>Timing</legend>
        <label className="radio">
          <input type="radio" name={`${id}-mode`} checked={mode === 'fixed_calendar'} onChange={() => setMode('fixed_calendar')} />
          Fixed dates
        </label>
        <label className="radio">
          <input
            type="radio"
            name={`${id}-mode`}
            checked={mode === 'completion_based'}
            onChange={() => setMode('completion_based')}
          />
          Count from when I last did it
        </label>
      </fieldset>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="button-row">
        <button type="button" className="aster-btn aster-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="aster-btn aster-btn--primary">
          Save
        </button>
      </div>
    </form>
  )
}
