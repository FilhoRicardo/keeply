import { describe, expect, it } from 'vitest'
import { fromTask, toRecommendation, toTask, type RecommendationRow, type SourceDocumentRow, type TaskRow } from './rows'

const source: SourceDocumentRow = {
  id: 'src-1',
  appliance_id: 'app-1',
  source_type: 'manufacturer_manual',
  title: 'Manual',
  reference: 'https://example.com',
  manufacturer: 'Bosch',
  model_scope: 'SMS6ZCI49E',
  retrieved_at: '2026-10-04T00:00:00Z',
}

const recRow: RecommendationRow = {
  id: 'rec-1',
  appliance_id: 'app-1',
  task_name: 'Clean filter',
  description: 'Rinse it',
  recommended_interval_count: 14,
  recommended_interval_unit: 'day',
  evidence_level: 'manufacturer_verified',
  source_document_id: 'src-1',
  source_location: 'page 32',
  confidence: 0.9,
  created_at: '2026-10-04T00:00:00Z',
}

const taskRow: TaskRow = {
  id: 'task-1',
  appliance_id: 'app-1',
  recommendation_id: 'rec-1',
  status: 'approved',
  user_interval_count: 30,
  user_interval_unit: 'day',
  start_date: '2026-06-01',
  scheduling_mode: 'completion_based',
  calendar_event_id: null,
  approved_at: '2026-10-04T10:00:00Z',
  created_at: '2026-10-04T10:00:00Z',
}

describe('row mappers', () => {
  it('maps a Recommendation with its provenance', () => {
    expect(toRecommendation(recRow, source)).toMatchObject({
      recommendedInterval: { count: 14, unit: 'day' },
      evidenceLevel: 'manufacturer_verified',
      source: { title: 'Manual', modelScope: 'SMS6ZCI49E' },
      sourceLocation: 'page 32',
    })
  })

  it('refuses to pair a Recommendation with the wrong source', () => {
    expect(() => toRecommendation(recRow, { ...source, id: 'src-2' })).toThrow()
  })

  it('round-trips a Task', () => {
    expect({ ...fromTask(toTask(taskRow), '2026-10-04T10:00:00Z'), created_at: taskRow.created_at }).toEqual(taskRow)
  })

  it('leaves approved_at empty for skipped tasks', () => {
    expect(fromTask(toTask({ ...taskRow, status: 'skipped' }), 'now').approved_at).toBeNull()
  })
})
