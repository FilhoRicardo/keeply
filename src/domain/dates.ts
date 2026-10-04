import type { Interval } from './format-interval'

// A calendar date with no time or zone: 'YYYY-MM-DD'. Maintenance is day-granular.
export type LocalDate = string

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isLocalDate(value: string): value is LocalDate {
  const match = LOCAL_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match.map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

function parse(date: LocalDate): Date {
  if (!isLocalDate(date)) throw new Error(`Not a LocalDate: ${date}`)
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

function format(date: Date): LocalDate {
  return date.toISOString().slice(0, 10)
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

// Month and year steps clamp to the last day of a shorter month (31 Jan + 1 month = 28/29 Feb).
export function addInterval(date: LocalDate, { count, unit }: Interval, times = 1): LocalDate {
  const d = parse(date)
  const n = count * times
  if (unit === 'day' || unit === 'week') {
    d.setUTCDate(d.getUTCDate() + n * (unit === 'week' ? 7 : 1))
    return format(d)
  }
  const months = unit === 'year' ? n * 12 : n
  const total = d.getUTCMonth() + months
  const year = d.getUTCFullYear() + Math.floor(total / 12)
  const month = ((total % 12) + 12) % 12
  const day = Math.min(d.getUTCDate(), daysInMonth(year, month))
  return format(new Date(Date.UTC(year, month, day)))
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function toLocalDate(instant: Date, timeZone = 'UTC'): LocalDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    instant,
  )
}
