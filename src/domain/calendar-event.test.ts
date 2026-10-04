import { describe, expect, it } from 'vitest'
import { applianceName, toCalendarEvent } from './calendar-event'
import type { Task } from './model'
import { toRRule } from './recurrence'
import { appliance, recommendation } from './test-fixtures'

const rec = recommendation()

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    applianceId: appliance.id,
    recommendationId: rec.id,
    status: 'approved',
    userInterval: { count: 30, unit: 'day' },
    startDate: '2026-10-05',
    schedulingMode: 'fixed_calendar',
    calendarEventId: null,
    ...overrides,
  }
}

describe('toRRule', () => {
  it.each([
    [{ count: 1, unit: 'month' as const }, 'RRULE:FREQ=MONTHLY'],
    [{ count: 3, unit: 'month' as const }, 'RRULE:FREQ=MONTHLY;INTERVAL=3'],
    [{ count: 2, unit: 'week' as const }, 'RRULE:FREQ=WEEKLY;INTERVAL=2'],
    [{ count: 30, unit: 'day' as const }, 'RRULE:FREQ=DAILY;INTERVAL=30'],
    [{ count: 1, unit: 'year' as const }, 'RRULE:FREQ=YEARLY'],
  ])('%o → %s', (interval, rule) => {
    expect(toRRule(interval)).toBe(rule)
  })

  it('rejects a zero interval', () => {
    expect(() => toRRule({ count: 0, unit: 'day' })).toThrow()
  })
})

describe('toCalendarEvent', () => {
  it('makes a recurring all-day event for a fixed-calendar task, using the user schedule', () => {
    const event = toCalendarEvent(task(), rec, appliance)
    expect(event).toMatchObject({
      taskId: 'task-1',
      summary: 'Clean the filter · Bosch SMS6ZCI49E dishwasher',
      date: '2026-10-05',
      endDate: '2026-10-06',
      recurrence: ['RRULE:FREQ=DAILY;INTERVAL=30'],
    })
  })

  it('keeps the recommendation, its evidence level and source visible alongside the user schedule', () => {
    const { description } = toCalendarEvent(task(), rec, appliance)
    expect(description).toContain('Your schedule: Every 30 days')
    expect(description).toContain('Recommendation: Every 14 days (Manufacturer verified)')
    expect(description).toContain('Source: Bosch SMS6ZCI49E user manual, page 32')
  })

  it('never labels general guidance as verified in the event', () => {
    const general = recommendation({ evidenceLevel: 'general_guidance' })
    expect(toCalendarEvent(task(), general, appliance).description).not.toMatch(/verified/i)
  })

  it('makes a single event on the next due date for a completion-based task', () => {
    const event = toCalendarEvent(task({ schedulingMode: 'completion_based' }), rec, appliance, [
      { taskId: 'task-1', completedOn: '2026-10-20', notes: null },
    ])
    expect(event).toMatchObject({ date: '2026-11-19', recurrence: [] })
    expect(event.description).toContain('after each completion')
  })

  it.each(['skipped', 'proposed', 'paused'] as const)('refuses a %s task', (status) => {
    expect(() => toCalendarEvent(task({ status }), rec, appliance)).toThrow(/approved/)
  })

  it('names an appliance without a model', () => {
    expect(applianceName({ manufacturer: 'Miele', model: null })).toBe('Miele dishwasher')
  })
})
