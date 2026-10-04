import type { Appliance, Completion, Recommendation, SourceDocument, Task } from '@/domain/model'

// Row shapes as stored in supabase/migrations/20261004120000_initial_schema.sql.

export type ApplianceRow = {
  id: string
  home_id: string
  category: 'dishwasher'
  manufacturer: string
  model: string | null
  serial_number: string | null
  image_url: string | null
  identification_confidence: number | null
  created_at: string
}

export type SourceDocumentRow = {
  id: string
  appliance_id: string
  source_type: SourceDocument['sourceType']
  title: string
  reference: string | null
  manufacturer: string | null
  model_scope: string | null
  retrieved_at: string
}

export type RecommendationRow = {
  id: string
  appliance_id: string
  task_name: string
  description: string
  recommended_interval_count: number
  recommended_interval_unit: Recommendation['recommendedInterval']['unit']
  evidence_level: Recommendation['evidenceLevel']
  source_document_id: string
  source_location: string | null
  confidence: number | null
  created_at: string
}

export type TaskRow = {
  id: string
  appliance_id: string
  recommendation_id: string
  status: Task['status']
  user_interval_count: number
  user_interval_unit: Task['userInterval']['unit']
  start_date: string
  scheduling_mode: Task['schedulingMode']
  calendar_event_id: string | null
  approved_at: string | null
  created_at: string
}

export type CompletionRow = {
  id: string
  maintenance_task_id: string
  completed_on: string
  notes: string | null
  created_at: string
}

export function toAppliance(row: ApplianceRow): Appliance {
  return {
    id: row.id,
    category: row.category,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serial_number,
    createdAt: row.created_at,
  }
}

export function toSourceDocument(row: SourceDocumentRow): SourceDocument {
  return {
    id: row.id,
    sourceType: row.source_type,
    title: row.title,
    reference: row.reference,
    manufacturer: row.manufacturer,
    modelScope: row.model_scope,
  }
}

export function toRecommendation(row: RecommendationRow, source: SourceDocumentRow): Recommendation {
  if (row.source_document_id !== source.id) throw new Error('Recommendation and source document do not match.')
  return {
    id: row.id,
    applianceId: row.appliance_id,
    taskName: row.task_name,
    description: row.description,
    recommendedInterval: { count: row.recommended_interval_count, unit: row.recommended_interval_unit },
    evidenceLevel: row.evidence_level,
    source: toSourceDocument(source),
    sourceLocation: row.source_location,
  }
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    applianceId: row.appliance_id,
    recommendationId: row.recommendation_id,
    status: row.status,
    userInterval: { count: row.user_interval_count, unit: row.user_interval_unit },
    startDate: row.start_date,
    schedulingMode: row.scheduling_mode,
    calendarEventId: row.calendar_event_id,
  }
}

// Insert payload for a Task. approved_at is required by the schema for approved tasks.
export function fromTask(task: Task, approvedAt: string): Omit<TaskRow, 'created_at'> {
  return {
    id: task.id,
    appliance_id: task.applianceId,
    recommendation_id: task.recommendationId,
    status: task.status,
    user_interval_count: task.userInterval.count,
    user_interval_unit: task.userInterval.unit,
    start_date: task.startDate,
    scheduling_mode: task.schedulingMode,
    calendar_event_id: task.calendarEventId,
    approved_at: task.status === 'approved' || task.status === 'paused' ? approvedAt : null,
  }
}

export function toCompletion(row: CompletionRow): Completion {
  return { taskId: row.maintenance_task_id, completedOn: row.completed_on, notes: row.notes }
}
