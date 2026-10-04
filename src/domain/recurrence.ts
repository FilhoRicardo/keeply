import type { Interval, IntervalUnit } from './format-interval'

const FREQ: Record<IntervalUnit, string> = {
  day: 'DAILY',
  week: 'WEEKLY',
  month: 'MONTHLY',
  year: 'YEARLY',
}

// RFC 5545 recurrence rule for a fixed-calendar interval.
export function toRRule({ count, unit }: Interval): string {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Invalid interval count: ${count}`)
  return count === 1 ? `RRULE:FREQ=${FREQ[unit]}` : `RRULE:FREQ=${FREQ[unit]};INTERVAL=${count}`
}
