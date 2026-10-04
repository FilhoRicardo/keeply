export type IntervalUnit = 'day' | 'week' | 'month' | 'year'

export type Interval = { count: number; unit: IntervalUnit }

export function formatInterval({ count, unit }: Interval): string {
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`
}
