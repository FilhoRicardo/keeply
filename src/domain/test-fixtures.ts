import type { Appliance, Recommendation } from './model'

export const appliance: Appliance = {
  id: 'app-1',
  category: 'dishwasher',
  manufacturer: 'Bosch',
  model: 'SMS6ZCI49E',
  serialNumber: null,
  createdAt: '2026-10-04T10:00:00Z',
}

export function recommendation(overrides: Partial<Recommendation> = {}): Recommendation {
  return {
    id: 'rec-filter',
    applianceId: appliance.id,
    taskName: 'Clean the filter',
    description: 'Rinse the filter.',
    recommendedInterval: { count: 14, unit: 'day' },
    evidenceLevel: 'manufacturer_verified',
    source: {
      id: 'src-1',
      sourceType: 'manufacturer_manual',
      title: 'Bosch SMS6ZCI49E user manual',
      reference: 'https://example.com/manual.pdf',
      manufacturer: 'Bosch',
      modelScope: 'SMS6ZCI49E',
    },
    sourceLocation: 'page 32',
    ...overrides,
  }
}

export function sequentialIds(prefix = 'task') {
  let n = 0
  return () => `${prefix}-${++n}`
}

// Deep-freeze so any attempt to rewrite a Recommendation throws in strict mode.
export function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}
