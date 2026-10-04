import { describe, expect, it } from 'vitest'
import type { Task } from './model'
import { isOverdue, nextDue, validateCompletion } from './schedule'

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    applianceId: 'app-1',
    recommendationId: 'rec-1',
    status: 'approved',
    userInterval: { count: 30, unit: 'day' },
    startDate: '2026-06-01',
    schedulingMode: 'completion_based',
    calendarEventId: null,
    ...overrides,
  }
}

describe('nextDue', () => {
  it('is the start date before any completion', () => {
    expect(nextDue(task(), [])).toBe('2026-06-01')
  })

  it('completion-based: due 1 June, done 6 June → next due 6 July (handoff §6)', () => {
    const completions = [{ taskId: 't1', completedOn: '2026-06-06', notes: null }]
    expect(nextDue(task(), completions)).toBe('2026-07-06')
  })

  it('uses the latest completion and ignores other tasks', () => {
    const completions = [
      { taskId: 't1', completedOn: '2026-06-20', notes: null },
      { taskId: 't1', completedOn: '2026-06-06', notes: null },
      { taskId: 'other', completedOn: '2026-09-01', notes: null },
    ]
    expect(nextDue(task(), completions)).toBe('2026-07-20')
  })

  it('fixed calendar: stays on the original grid regardless of when it was done', () => {
    const fixed = task({ schedulingMode: 'fixed_calendar' })
    expect(nextDue(fixed, [{ taskId: 't1', completedOn: '2026-06-06', notes: null }])).toBe('2026-07-01')
    expect(nextDue(fixed, [{ taskId: 't1', completedOn: '2026-07-01', notes: null }])).toBe('2026-07-31')
  })
})

describe('isOverdue', () => {
  it('is overdue only after the due date', () => {
    expect(isOverdue('2026-10-03', '2026-10-04')).toBe(true)
    expect(isOverdue('2026-10-04', '2026-10-04')).toBe(false)
  })
})

describe('validateCompletion', () => {
  it('accepts today or a past date with an optional short note', () => {
    expect(validateCompletion('2026-10-04', '2026-10-04', null)).toBeNull()
    expect(validateCompletion('2026-09-30', '2026-10-04', 'Filter was very dirty')).toBeNull()
  })

  it('rejects future dates, bad dates and long notes', () => {
    expect(validateCompletion('2026-10-05', '2026-10-04', null)).toMatch(/future/)
    expect(validateCompletion('yesterday', '2026-10-04', null)).toMatch(/date/)
    expect(validateCompletion('2026-10-04', '2026-10-04', 'x'.repeat(281))).toMatch(/280/)
  })
})
