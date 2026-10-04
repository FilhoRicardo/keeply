import type { LocalDate } from './dates'
import type { Interval, IntervalUnit } from './format-interval'

const FREQ: Record<IntervalUnit, string> = {
  day: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'YEARLY',
}

// RFC 5545 recurrence rule for a fixed-calendar interval starting on `start`.
// Keeply clamps month/year steps to the last day of shorter months (31 Jan → 28 Feb), while a
// plain MONTHLY rule makes calendars skip those months. For start days 29–31 the rule therefore
// picks the last existing day among 28…start day, which gives exactly Keeply's dates.
export function toRRule({ count, unit }: Interval, start?: LocalDate): string {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid interval count: ${count}`)
  let rule = `RRULE:FREQ=${FREQ[unit]}${count === 1 ? '' : `;INTERVAL=${count}`}`
  const [, month, day] = start ? start.split('-').map(Number) : [0, 0, 0]
  const monthDays = (last: number) => Array.from({ length: last - 27 }, (_, i) => 28 + i).join(',')
  if (unit === 'month' && day > 28) rule += `;BYMONTHDAY=${monthDays(day)};BYSETPOS=-1`
  if (unit === 'year' && month === 2 && day === 29) rule += `;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1`
  return rule
}
