import { toLocalDate, type LocalDate } from '@/domain/dates'

export function today(): LocalDate {
  return toLocalDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)
}

// The local calendar day of an instant (e.g. when a plan was approved).
export function localDay(instant: string): LocalDate {
  return toLocalDate(new Date(instant), Intl.DateTimeFormat().resolvedOptions().timeZone)
}
