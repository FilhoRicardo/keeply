import type { Appliance, ApplianceRecord, MaintenanceTask, TaskProposal } from '@/domain/model'
import { decodeSourceLocation, encodeSourceLocation } from '@/domain/model-family'

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

export function toApplianceRecord(tree: ApplianceTree): ApplianceRecord {
  return {
    appliance: toAppliance(tree),
    tasks: [...tree.maintenance_tasks].sort((a, b) => a.position - b.position).map(toTask),
    approvedAt: tree.approved_at,
    startDate: tree.start_date,
    // KEE-43: the Supabase schema does not yet persist proposalMeta; the plan page falls back
    // to a generic "we could not find a manual" message in that case.
    proposalMeta: null,
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
