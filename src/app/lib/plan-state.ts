import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { ApplianceRecord, MaintenanceTask, ProposalMeta, TaskProposal } from '@/domain/model'
import { approvePlan, decideTask, type Decision } from '@/domain/plan'

// Everything Keeply keeps: the owner's dishwashers and their plans. Pure transitions only;
// persistence lives in plan-repository.ts.
export type PlanState = { version: 2; records: ApplianceRecord[] }

export const EMPTY_STATE: PlanState = { version: 2, records: [] }

export type NewApplianceInput = {
  manufacturer: string
  model: string
  serialNumber: string
  // The recogniser's confidence when the owner kept its proposal unchanged.
  confidence?: number | null
}

function clean(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function validateNewAppliance(input: NewApplianceInput): string | null {
  return clean(input.manufacturer) ? null : 'Enter the manufacturer, for example Bosch.'
}

export function findRecord(state: PlanState, applianceId: string): ApplianceRecord | undefined {
  return state.records.find((r) => r.appliance.id === applianceId)
}

function updateRecord(state: PlanState, applianceId: string, update: (r: ApplianceRecord) => ApplianceRecord): PlanState {
  if (!findRecord(state, applianceId)) throw new Error(`Unknown appliance ${applianceId}`)
  return { ...state, records: state.records.map((r) => (r.appliance.id === applianceId ? update(r) : r)) }
}

export function addAppliance(
  state: PlanState,
  input: NewApplianceInput,
  proposals: readonly TaskProposal[],
  newId: () => string,
  now: string,
  meta: ProposalMeta | null = null,
): { state: PlanState; applianceId: string } {
  const error = validateNewAppliance(input)
  if (error) throw new Error(error)
  if (proposals.length === 0) throw new Error('A dishwasher needs at least one proposed task.')
  const applianceId = newId()
  const tasks: MaintenanceTask[] = proposals.map((p) => ({
    ...p,
    id: newId(),
    applianceId,
    status: 'proposed',
    calendarEventId: null,
  }))
  const record: ApplianceRecord = {
    appliance: {
      id: applianceId,
      manufacturer: clean(input.manufacturer)!,
      model: clean(input.model),
      serialNumber: clean(input.serialNumber),
      identificationConfidence: input.confidence ?? null,
      createdAt: now,
    },
    tasks,
    approvedAt: null,
    startDate: null,
    proposalMeta: meta,
  }
  return { state: { ...state, records: [...state.records, record] }, applianceId }
}

export function decide(state: PlanState, applianceId: string, taskId: string, decision: Decision | null): PlanState {
  return updateRecord(state, applianceId, (r) => decideTask(r, taskId, decision))
}

export function approve(state: PlanState, applianceId: string, startDate: LocalDate, now: string): PlanState {
  return updateRecord(state, applianceId, (r) => approvePlan(r, startDate, now))
}

export function recordCalendarResults(state: PlanState, applianceId: string, results: readonly WriteResult[]): PlanState {
  return updateRecord(state, applianceId, (r) => ({
    ...r,
    tasks: r.tasks.map((task) => {
      const result = results.find((res) => res.taskId === task.id)
      if (!result?.ok || task.status !== 'accepted' || !r.approvedAt) return task
      return { ...task, calendarEventId: result.eventId }
    }),
  }))
}

export function removeAppliance(state: PlanState, applianceId: string): PlanState {
  if (!findRecord(state, applianceId)) throw new Error(`Unknown appliance ${applianceId}`)
  return { ...state, records: state.records.filter((r) => r.appliance.id !== applianceId) }
}

// Plans saved by an older version of Keeply are not migrated (pre-release prototype).
// KEE-43: older plan snapshots (pre-meta) are read as records with no proposalMeta. The plan
// page renders the all-general banner without a reason in that case.
export function parseState(raw: string | null): PlanState {
  if (!raw) return EMPTY_STATE
  try {
    const parsed = JSON.parse(raw) as PlanState & { records?: (ApplianceRecord & { proposalMeta?: ProposalMeta | null })[] }
    if (parsed?.version !== 2 || !Array.isArray(parsed.records)) return EMPTY_STATE
    const records = parsed.records.map((r) => ({ ...r, proposalMeta: r.proposalMeta ?? null }))
    return { version: 2, records }
  } catch {
    return EMPTY_STATE
  }
}
