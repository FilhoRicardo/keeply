'use client'

import { useState } from 'react'
import type { LocalDate } from '@/domain/dates'
import { MAX_COMPLETION_NOTE, validateCompletion } from '@/domain/schedule'

// When the owner did the task (defaults to today) and an optional note.
export function CompletionForm({
  today,
  onSave,
  onCancel,
}: {
  today: LocalDate
  onSave: (completedOn: LocalDate, notes: string | null) => Promise<void> | void
  onCancel: () => void
}) {
  const [date, setDate] = useState(today)
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const note = notes.trim() || null
    const problem = validateCompletion(date, today, note)
    if (problem) return setError(problem)
    setError(null)
    setSaving(true)
    try {
      await onSave(date, note)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="customise-form" onSubmit={submit} aria-label="Record completion" noValidate>
      <label className="field">
        <span>Done on</span>
        <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="field">
        <span>
          Note <small>(optional)</small>
        </span>
        <textarea
          className="input"
          rows={2}
          maxLength={MAX_COMPLETION_NOTE}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="button-row">
        <button type="button" className="aster-btn aster-btn--ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="aster-btn aster-btn--primary" disabled={saving}>
          Save
        </button>
      </div>
    </form>
  )
}
