import type { LocalDate } from './dates'
import type { EvidenceLevel } from './evidence'
import type { Interval } from './format-interval'

// Keeply's appliance record. KEE-60: any household appliance, not only dishwashers. The category
// (dishwasher, fridge, etc.) is captured on the confirm screen but is not persisted — only the
// manufacturer, model and serial number identify the appliance in storage.
export type Appliance = {
  readonly id: string
  readonly manufacturer: string
  readonly model: string | null
  readonly serialNumber: string | null
  // 0..1 when a recogniser proposed the identity and the owner kept it unchanged; null when typed.
  readonly identificationConfidence: number | null
  readonly createdAt: string
}

export type SourceType = 'manufacturer_manual' | 'manufacturer_website' | 'similar_model_manual' | 'general_guidance'

// Where a proposed task comes from. Provenance is first-class: shown to the owner and written
// into the calendar event.
export type Source = {
  readonly type: SourceType
  readonly title: string
  // Public https link to the document, when there is one.
  readonly url: string | null
  // Page or section in the document.
  readonly location: string | null
  // The document's own words, required for Manufacturer verified.
  readonly quote: string | null
}

// What Keeply proposes, from a source. Never rewritten afterwards: the owner only accepts or rejects it.
export type TaskProposal = {
  readonly name: string
  readonly instructions: string
  readonly interval: Interval
  readonly evidenceLevel: EvidenceLevel
  readonly source: Source
}

export type TaskStatus = 'proposed' | 'accepted' | 'rejected'

export type MaintenanceTask = TaskProposal & {
  readonly id: string
  readonly applianceId: string
  readonly status: TaskStatus
  // Set once the accepted task is in the owner's calendar.
  readonly calendarEventId: string | null
}

// What the live plan proposer learned when it built this plan. Honest provenance of why the
// owner is looking at a general-guidance list (KEE-43). The Supabase adapter does not yet
// persist this; the field is then null after a Supabase round-trip and the plan page falls
// back to a generic "we could not find a manual" message.
export type ProposalMeta = {
  readonly fallback: 'exact' | 'similar' | 'general'
  readonly searchOutcome:
    | 'ok'
    | 'no_results'
    | 'quota_exhausted'
    | 'fetch_failed'
    | 'extraction_unavailable'
    | 'unreadable'
    | 'no_text'
    | 'timeout'
    | 'unavailable'
  readonly searchReason: string | null
  readonly searched: boolean
}

// One dishwasher and its plan. After Approval the owner manages the tasks in their calendar.
export type ApplianceRecord = {
  readonly appliance: Appliance
  readonly tasks: readonly MaintenanceTask[]
  readonly approvedAt: string | null
  // First calendar date for every accepted task, chosen at Approval.
  readonly startDate: LocalDate | null
  // Set when a live search (KEE-42 /api/plan) built this plan; null for the local
  // general-guidance proposer and for any Supabase round-trip that does not yet persist it.
  readonly proposalMeta: ProposalMeta | null
}
