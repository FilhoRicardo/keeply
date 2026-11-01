import type { Appliance, ApplianceRecord, MaintenanceTask, ProposalMeta, TaskProposal } from '@/domain/model'
import { decodeSourceLocation, encodeSourceLocation } from '@/domain/model-family'
import { proposalMetaFromStorage } from '@/app/lib/plan-search-outcomes'

// Row shapes as stored in supabase/migrations. proposal_meta landed in
// 20261011120000_proposal_meta.sql (RF-352).

export type ApplianceRow = {
  id: string
  user_id: string
  manufacturer: string
  model: string | null
  serial_number: string | null
  identification_confidence: number | null
  approved_at: string | null
  start_date: string | null
  created_at: string
  // Null on rows saved before RF-352. Unknown provenance, not "no manual found".
  proposal_meta: unknown
}

export type TaskRow = {
  id: string
  appliance_id: string
  position: number
  name: string
  instructions: string
  interval_count: number
  interval_unit: MaintenanceTask['interval']['unit']
  evidence_level: MaintenanceTask['evidenceLevel']
  source_type: MaintenanceTask['source']['type']
  source_title: string
  source_url: string | null
  source_location: string | null
  source_quote: string | null
  status: MaintenanceTask['status']
  calendar_event_id: string | null
  created_at: string
}

export type ApplianceTree = ApplianceRow & { maintenance_tasks: TaskRow[] }

function sourceFromRow(row: TaskRow): MaintenanceTask['source'] {
  const covered = decodeSourceLocation(row.source_location)
  return {
    type: row.source_type,
    title: row.source_title,
    url: row.source_url,
    location: covered.location,
    quote: row.source_quote,
    ...(covered.coveredModel ? { coveredModel: covered.coveredModel } : {}),
  }
}

export function toTask(row: TaskRow): MaintenanceTask {
  return {
    id: row.id,
    applianceId: row.appliance_id,
    name: row.name,
    instructions: row.instructions,
    interval: { count: row.interval_count, unit: row.interval_unit },
    evidenceLevel: row.evidence_level,
    source: sourceFromRow(row),
    status: row.status,
    calendarEventId: row.calendar_event_id,
  }
}

export function toAppliance(row: ApplianceRow): Appliance {
  return {
    id: row.id,
    manufacturer: row.manufacturer,
    model: row.model,
    serialNumber: row.serial_number,
    // numeric arrives as a string from PostgREST.
    identificationConfidence: row.identification_confidence === null ? null : Number(row.identification_confidence),
    createdAt: row.created_at,
  }
}

const PROPOSAL_FALLBACKS = ['exact', 'similar', 'general'] as const
const PROPOSAL_OUTCOMES = [
  'ok',
  'no_results',
  'search_error',
  'search_empty',
  'manual_found_ai_no_tasks',
  'quota_exhausted',
  'fetch_failed',
  'extraction_unavailable',
  'unreadable',
  'no_text',
  'timeout',
  'unavailable',
  'no_plan',
] as const

function isOneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

// A stored document that is missing or the wrong shape is unknown provenance. Never invent
// a search outcome from it: that is what made old rows say "no manufacturer manual found".
function proposalMetaFromRow(value: unknown): ProposalMeta | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const meta = value as Record<string, unknown>
  if (!isOneOf(meta.fallback, PROPOSAL_FALLBACKS)) return null
  if (!isOneOf(meta.searchOutcome, PROPOSAL_OUTCOMES)) return null
  if (typeof meta.searched !== 'boolean') return null
  if (meta.searchReason !== null && typeof meta.searchReason !== 'string') return null
  return proposalMetaFromStorage({
    fallback: meta.fallback,
    searchOutcome: meta.searchOutcome,
    searchReason: meta.searchReason,
    searched: meta.searched,
  })
}

export function toApplianceRecord(tree: ApplianceTree): ApplianceRecord {
  return {
    appliance: toAppliance(tree),
    tasks: [...tree.maintenance_tasks].sort((a, b) => a.position - b.position).map(toTask),
    approvedAt: tree.approved_at,
    startDate: tree.start_date,
    proposalMeta: proposalMetaFromRow(tree.proposal_meta),
  }
}

// The add_appliance RPC's task payload.
export function fromProposal(p: TaskProposal) {
  return {
    name: p.name,
    instructions: p.instructions,
    interval_count: p.interval.count,
    interval_unit: p.interval.unit,
    evidence_level: p.evidenceLevel,
    source_type: p.source.type,
    source_title: p.source.title,
    source_url: p.source.url,
    source_location: encodeSourceLocation(p.source.location, p.source.coveredModel),
    source_quote: p.source.quote,
  }
}
