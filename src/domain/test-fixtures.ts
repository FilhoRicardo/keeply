import type { Appliance, ApplianceRecord, MaintenanceTask } from './model'

export const appliance: Appliance = {
  id: 'app-1',
  manufacturer: 'Bosch',
  model: 'SMS6ZCI49E',
  serialNumber: null,
  identificationConfidence: null,
  createdAt: '2026-10-04T10:00:00Z',
}

export function task(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id: 'task-filter',
    applianceId: appliance.id,
    name: 'Clean the filter',
    instructions: 'Rinse the filter.',
    interval: { count: 14, unit: 'day' },
    evidenceLevel: 'manufacturer_verified',
    source: {
      type: 'manufacturer_manual',
      title: 'Bosch SMS6ZCI49E user manual',
      url: 'https://example.com/manual.pdf',
      location: 'page 32',
      quote: 'Check and clean the filters regularly.',
    },
    status: 'proposed',
    calendarEventId: null,
    ...overrides,
  }
}

export function record(overrides: Partial<ApplianceRecord> = {}): ApplianceRecord {
  return {
    appliance,
    tasks: [task(), task({ id: 'task-rinse', name: 'Top up rinse aid', interval: { count: 1, unit: 'month' } })],
    approvedAt: null,
    startDate: null,
    ...overrides,
  }
}

// Deep-freeze so any attempt to rewrite a proposal throws in strict mode.
export function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(frozen)
    Object.freeze(value)
  }
  return value
}
