import { describe, expect, it } from 'vitest'
import { formatInterval } from './format-interval'

describe('formatInterval', () => {
  it('reads a single unit as "Every <unit>"', () => {
    expect(formatInterval({ count: 1, unit: 'month' })).toBe('Every month')
  })

  it('pluralises the unit for counts above one', () => {
    expect(formatInterval({ count: 3, unit: 'month' })).toBe('Every 3 months')
  })
})
