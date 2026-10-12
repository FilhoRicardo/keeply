import { describe, expect, it } from 'vitest'
import { applianceName, draftsForTasks, toCalendarEvent } from './calendar-event'
import { manualSourceTitle } from './manual-title'
import { toRRule } from './recurrence'
import { appliance, record, task } from './test-fixtures'

const accepted = task({ status: 'accepted' })

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
  it('makes one recurring all-day event from the plan start date', () => {
    expect(toCalendarEvent(accepted, appliance, '2026-10-05')).toMatchObject({
      taskId: 'task-filter',
      summary: 'Clean the filter · Bosch SMS6ZCI49E',
      date: '2026-10-05',
      endDate: '2026-10-06',
      recurrence: ['RRULE:FREQ=MONTHLY'],
    })
  })

  it('carries the instructions, evidence level and source, quote and link', () => {
    const { description } = toCalendarEvent(accepted, appliance, '2026-10-05')
    expect(description).toContain('Rinse the filter.')
    expect(description).toContain(`Every month · Keeply's suggestion. The manual says "regularly". · Manufacturer verified`)
    expect(description).toContain('Source: Bosch SMS6ZCI49E user manual, page 32')
    expect(description).toContain('“Check and clean the filters regularly.”')
    expect(description).toContain('https://example.com/manual.pdf')
  })

  it('writes the readable manual name into the event, including when the document title was a host label', () => {
    const title = manualSourceTitle({
      documentTitle: 'Electrolux-medialibrary',
      manufacturer: 'Electrolux',
      model: 'KEQB7300L',
    })
    const electrolux = task({
      status: 'accepted',
      source: {
        type: 'manufacturer_manual',
        title,
        url: 'https://api.electrolux-medialibrary.com/asset/550e8400-e29b-41d4-a716-446655440000/ORIGINAL/550e8400-e29b-41d4-a716-446655440000.pdf',
        location: 'page 22',
        quote: 'Clean the condenser every three months.',
      },
    })
    const { description } = toCalendarEvent(
      electrolux,
      { ...appliance, manufacturer: 'Electrolux', model: 'KEQB7300L' },
      '2026-10-12',
    )
    expect(description).toContain('Source: Electrolux KEQB7300L user manual, page 22')
  })

  it('repeats a stated cadence from the quote, not the stored interval', () => {
    const stated = task({
      status: 'accepted',
      interval: { count: 1, unit: 'month' },
      source: { ...task().source, quote: 'Check and clean the filters every 14 days.' },
    })
    const event = toCalendarEvent(stated, appliance, '2026-10-05')
    expect(event.recurrence).toEqual(['RRULE:FREQ=DAILY;INTERVAL=14'])
    expect(event.description).toContain('Every 14 days · from the manual · Manufacturer verified')
  })

  it('never labels general guidance as verified in the event', () => {
    const general = task({
      status: 'accepted',
      evidenceLevel: 'general_guidance',
      source: { type: 'general_guidance', title: 'General', url: null, location: null, quote: null },
    })
    const event = toCalendarEvent(general, appliance, '2026-10-05')
    expect(event.recurrence).toEqual(['RRULE:FREQ=DAILY;INTERVAL=14'])
    expect(event.description).toContain('Every 14 days · General guidance')
    expect(event.description).not.toMatch(/verified/i)
    expect(event.description).not.toMatch(/Keeply's suggestion|from the manual/)
  })

  it.each(['proposed', 'rejected'] as const)('refuses a %s task', (status) => {
    expect(() => toCalendarEvent(task({ status }), appliance, '2026-10-05')).toThrow(/accepted/)
  })

  it('names an appliance without a model', () => {
    expect(applianceName({ manufacturer: 'Miele', model: null })).toBe('Miele')
  })
})

describe('draftsForTasks', () => {
  const approved = record({
    tasks: [accepted, task({ id: 'task-rinse', status: 'rejected' })],
    approvedAt: '2026-10-04T10:00:00Z',
    startDate: '2026-10-05',
  })

  it('drafts only accepted tasks of an approved plan', () => {
    expect(draftsForTasks(approved, ['task-filter', 'task-rinse', 'task-unknown']).map((d) => d.taskId)).toEqual(['task-filter'])
  })

  it('refuses a plan that is not approved', () => {
    expect(() => draftsForTasks(record({ tasks: [accepted] }), ['task-filter'])).toThrow(/Approve/)
  })
})

describe('toRRule month-end starts', () => {
  it.each([
    [{ count: 1, unit: 'month' as const }, '2026-01-31', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1'],
    [{ count: 3, unit: 'month' as const }, '2026-01-30', 'RRULE:FREQ=MONTHLY;INTERVAL=3;BYMONTHDAY=28,29,30;BYSETPOS=-1'],
    [{ count: 1, unit: 'month' as const }, '2026-01-29', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1'],
    [{ count: 1, unit: 'month' as const }, '2026-01-28', 'RRULE:FREQ=MONTHLY'],
    [{ count: 1, unit: 'year' as const }, '2028-02-29', 'RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1'],
    [{ count: 2, unit: 'week' as const }, '2026-01-31', 'RRULE:FREQ=WEEKLY;INTERVAL=2'],
  ])('%o from %s → %s', (interval, start, rule) => {
    expect(toRRule(interval, start)).toBe(rule)
  })

  // Expand the rule with a real RFC 5545 engine and compare with Keeply's own grid.
  it.each([
    ['2026-01-31', { count: 1, unit: 'month' as const }],
    ['2026-01-30', { count: 1, unit: 'month' as const }],
    ['2027-12-29', { count: 2, unit: 'month' as const }],
    ['2026-03-31', { count: 3, unit: 'month' as const }],
    ['2028-02-29', { count: 1, unit: 'year' as const }],
  ])('calendar dates from %s every %o match Keeply', async (start, interval) => {
    const { rrulestr } = await import('rrule')
    const { addInterval } = await import('./dates')
    const [y, m, d] = start.split('-').map(Number)
    const rule = rrulestr(toRRule(interval, start).replace('RRULE:', ''), { dtstart: new Date(Date.UTC(y, m - 1, d)) })
    const calendar = rule.all((_, i) => i < 24).map((date) => date.toISOString().slice(0, 10))
    const keeply = Array.from({ length: 24 }, (_, n) => addInterval(start, interval, n))
    expect(calendar).toEqual(keeply)
  })
})
