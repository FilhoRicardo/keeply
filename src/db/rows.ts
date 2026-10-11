import type { Appliance, ApplianceRecord, MaintenanceTask, ProposalMeta, TaskProposal } from '@/domain/model'
import { decodeSourceLocation, encodeSourceLocation } from '@/domain/model-family'

// Matches proposal_search_reason_length in 20261011120000_proposal_meta.sql.
export const PROPOSAL_SEARCH_REASON_MAX = 200

// Row shapes as stored in supabase/migrations/20261005090000_mvp_schema.sql.

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
  // Null together when the plan was saved before the reason columns existed.
  proposal_fallback: string | null
  proposal_search_outcome: string | null
  proposal_search_reason: string | null
  proposal_searched: boolean | null
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

function isFallback(value: string | null | undefined): value is ProposalMeta['fallback'] {
  return value === 'exact' || value === 'similar' || value === 'general'
}

function isSearchOutcome(value: string | null | undefined): value is ProposalMeta['searchOutcome'] {
  return (
    value === 'ok' ||
    value === 'no_results' ||
    value === 'quota_exhausted' ||
    value === 'fetch_failed' ||
    value === 'extraction_unavailable' ||
    value === 'unreadable' ||
    value === 'no_text' ||
    value === 'timeout' ||
    value === 'unavailable' ||
    value === 'no_plan'
  )
}

// Null when the row has no saved reason, or the stored values are not a complete outcome.
// The plan page then shows a neutral banner rather than claiming no manual was found.
export function proposalMetaFromRow(
  row: Pick<ApplianceRow, 'proposal_fallback' | 'proposal_search_outcome' | 'proposal_search_reason' | 'proposal_searched'>,
): ProposalMeta | null {
  if (!isFallback(row.proposal_fallback) || !isSearchOutcome(row.proposal_search_outcome) || typeof row.proposal_searched !== 'boolean') {
    return null
  }
  const reason = row.proposal_search_reason
  return {
    fallback: row.proposal_fallback,
    searchOutcome: row.proposal_search_outcome,
    searchReason: typeof reason === 'string' && reason.length > 0 ? reason : null,
    searched: row.proposal_searched,
  }
}

// Named arguments for add_appliance. Empty reasons are stored as null.
export function proposalRpcArgs(meta: ProposalMeta | null): {
  p_proposal_fallback: ProposalMeta['fallback'] | null
  p_proposal_search_outcome: ProposalMeta['searchOutcome'] | null
  p_proposal_search_reason: string | null
  p_proposal_searched: boolean | null
} {
  if (!meta) {
    return {
      p_proposal_fallback: null,
      p_proposal_search_outcome: null,
      p_proposal_search_reason: null,
      p_proposal_searched: null,
    }
  }
  const reason = meta.searchReason?.trim() ?? ''
  return {
    p_proposal_fallback: meta.fallback,
    p_proposal_search_outcome: meta.searchOutcome,
    p_proposal_search_reason: reason ? reason.slice(0, PROPOSAL_SEARCH_REASON_MAX) : null,
    p_proposal_searched: meta.searched,
  }
}

export function toApplianceRecord(tree: ApplianceTree): ApplianceRecord {
  return {
    appliance: toAppliance(tree),
    tasks: [...tree.maintenance_tasks].sort((a, b) => a.position - b.position).map(toTask),
    approvedAt: tree.approved_at,
    startDate: tree.start_date,
    proposalMeta: proposalMetaFromRow(tree),
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
