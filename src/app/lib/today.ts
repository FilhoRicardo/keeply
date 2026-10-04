import { toLocalDate, type LocalDate } from '@/domain/dates'

export function today(): LocalDate {
  return toLocalDate(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)
}
