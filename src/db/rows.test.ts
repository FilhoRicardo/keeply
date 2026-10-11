import { describe, expect, it } from 'vitest'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import { fromProposal, toApplianceRecord, type ApplianceTree, type TaskRow } from './rows'

const taskRow = (position: number, overrides: Partial<TaskRow> = {}): TaskRow => ({
  id: `task-${position}`,
  appliance_id: 'app-1',
  position,
  name: `Task ${position}`,
  instructions: 'Do it.',
  interval_count: 1,
  interval_unit: 'month',
  evidence_level: 'manufacturer_verified',
  source_type: 'manufacturer_manual',
  source_title: 'Manual',
  source_url: 'https://example.com/manual.pdf',
  source_location: 'page 32',
  source_quote: 'Clean the filters.',
  status: 'accepted',
  calendar_event_id: null,
  created_at: '2026-10-04T00:00:00Z',
  ...overrides,
})

const tree: ApplianceTree = {
  id: 'app-1',
  user_id: 'user-1',
  manufacturer: 'Bosch',
  model: 'SMS6ZCI49E',
  serial_number: null,
  identification_confidence: '0.95' as unknown as number,
  approved_at: '2026-10-04T10:00:00Z',
  start_date: '2026-10-05',
  created_at: '2026-10-04T00:00:00Z',
  maintenance_tasks: [taskRow(2), taskRow(1)],
}

describe('rows', () => {
  it('maps an appliance tree to a record, tasks in proposal order', () => {
    const record = toApplianceRecord(tree)
    expect(record.appliance).toMatchObject({ manufacturer: 'Bosch', identificationConfidence: 0.95 })
    expect(record.tasks.map((t) => t.id)).toEqual(['task-1', 'task-2'])
    expect(record.tasks[0].source).toEqual({
      type: 'manufacturer_manual',
      title: 'Manual',
      url: 'https://example.com/manual.pdf',
      location: 'page 32',
      quote: 'Clean the filters.',
    })
    expect(record).toMatchObject({ approvedAt: '2026-10-04T10:00:00Z', startDate: '2026-10-05' })
  })

  it('round-trips a similar-model covered model through source_location', () => {
    const proposal = {
      name: 'Clean the filter',
      instructions: 'Rinse it.',
      interval: { count: 1, unit: 'month' as const },
      evidenceLevel: 'similar_model' as const,
      source: {
        type: 'similar_model_manual' as const,
        title: 'Smeg DI6012 series',
        url: 'https://www.smeg.com/di6012.pdf',
        location: 'page 18',
        quote: 'Clean the filter once a month under running water.',
        coveredModel: 'DI6012-2',
      },
    }
    const payload = fromProposal(proposal)
    expect(payload.source_location).toBe('page 18 | covers DI6012-2')
    const back = toApplianceRecord({
      ...tree,
      maintenance_tasks: [taskRow(1, { ...payload, status: 'proposed' })],
    }).tasks[0]
    expect(back.source).toEqual(proposal.source)
    expect(back.evidenceLevel).toBe('similar_model')
  })

  it('round-trips a proposal through the RPC payload', () => {
    const payload = fromProposal(GENERAL_DISHWASHER_TASKS[0])
    const back = toApplianceRecord({ ...tree, maintenance_tasks: [taskRow(1, { ...payload, status: 'proposed' })] }).tasks[0]
    expect({ ...back, id: undefined, applianceId: undefined, status: undefined, calendarEventId: undefined }).toEqual({
      ...GENERAL_DISHWASHER_TASKS[0],
      id: undefined,
      applianceId: undefined,
      status: undefined,
      calendarEventId: undefined,
    })
  })
})
