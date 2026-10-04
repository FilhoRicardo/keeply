import { describe, expect, it } from 'vitest'
import { addInterval, compareDates, isLocalDate, toLocalDate } from './dates'

describe('addInterval', () => {
  it.each([
    ['2026-06-01', { count: 30, unit: 'day' as const }, '2026-07-01'],
    ['2026-06-01', { count: 2, unit: 'week' as const }, '2026-06-15'],
    ['2026-06-06', { count: 1, unit: 'month' as const }, '2026-07-06'],
    ['2026-11-15', { count: 3, unit: 'month' as const }, '2027-02-15'],
    ['2026-01-31', { count: 1, unit: 'month' as const }, '2026-02-28'],
    ['2028-01-31', { count: 1, unit: 'month' as const }, '2028-02-29'],
    ['2028-02-29', { count: 1, unit: 'year' as const }, '2029-02-28'],
  ])('%s + %o = %s', (date, interval, expected) => {
    expect(addInterval(date, interval)).toBe(expected)
  })

  it('steps from the anchor so month-end clamping does not drift', () => {
    expect(addInterval('2026-01-31', { count: 1, unit: 'month' }, 2)).toBe('2026-03-31')
  })

  it('rejects malformed dates', () => {
    expect(() => addInterval('2026-02-30', { count: 1, unit: 'day' })).toThrow()
  })
})

describe('LocalDate helpers', () => {
  it('validates real calendar dates only', () => {
    expect(isLocalDate('2026-10-04')).toBe(true)
    expect(isLocalDate('2026-02-29')).toBe(false)
    expect(isLocalDate('4 Oct 2026')).toBe(false)
  })

  it('compares lexically', () => {
    expect(compareDates('2026-01-02', '2026-01-10')).toBe(-1)
    expect(compareDates('2026-01-10', '2026-01-10')).toBe(0)
  })

  it('reads an instant as a date in the given zone', () => {
    const instant = new Date('2026-10-04T23:30:00Z')
    expect(toLocalDate(instant, 'UTC')).toBe('2026-10-04')
    expect(toLocalDate(instant, 'Europe/Lisbon')).toBe('2026-10-05')
  })
})
