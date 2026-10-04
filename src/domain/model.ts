import type { LocalDate } from './dates'
import type { EvidenceLevel } from './evidence'
import type { Interval } from './format-interval'

// v0.1 supports dishwashers only.
export type ApplianceCategory = 'dishwasher'

export type Appliance = {
  readonly id: string
  readonly category: ApplianceCategory
  readonly manufacturer: string
  readonly model: string | null
  readonly serialNumber: string | null
  readonly createdAt: string
}

export type SourceType = 'manufacturer_manual' | 'manufacturer_website' | 'similar_model_manual' | 'general_guidance'

export type SourceDocument = {
  readonly id: string
  readonly sourceType: SourceType
  readonly title: string
  readonly reference: string | null
  readonly manufacturer: string | null
  readonly modelScope: string | null
}

// What a source says to do. Never edited by the user: their choices live on the Task.
export type Recommendation = {
  readonly id: string
  readonly applianceId: string
  readonly taskName: string
  readonly description: string
  readonly recommendedInterval: Readonly<Interval>
  readonly evidenceLevel: EvidenceLevel
  readonly source: SourceDocument
  readonly sourceLocation: string | null
}

export type SchedulingMode = 'fixed_calendar' | 'completion_based'

export type TaskStatus = 'proposed' | 'approved' | 'skipped' | 'paused'

// What the owner approved from a Recommendation.
export type Task = {
  readonly id: string
  readonly applianceId: string
  readonly recommendationId: string
  readonly status: TaskStatus
  readonly userInterval: Interval
  readonly startDate: LocalDate
  readonly schedulingMode: SchedulingMode
  readonly calendarEventId: string | null
}

export type Completion = {
  readonly taskId: string
  readonly completedOn: LocalDate
  readonly notes: string | null
}
