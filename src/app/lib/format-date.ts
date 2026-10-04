import type { LocalDate } from '@/domain/dates'

// '2026-10-04' → '4 Oct 2026'. Formatted in UTC so the day never shifts.
export function formatDate(date: LocalDate): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
    new Date(`${date}T00:00:00Z`),
  )
}
