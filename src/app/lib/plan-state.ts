import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { Appliance, Completion, Recommendation, Task } from '@/domain/model'
import { mockRecommendations } from '@/domain/mock-recommendations'
import { approvePlan, type Decision, type Decisions } from '@/domain/plan'

// Everything Keeply knows about one appliance. Pure transitions only: persistence lives in plan-store.ts.
export type ApplianceRecord = {
  appliance: Appliance
  recommendations: Recommendation[]
  decisions: Decisions
  tasks: Task[]
  completions: Completion[]
  approvedAt: string | null
}

export type PlanState = { version: 1; records: ApplianceRecord[] }

export const EMPTY_STATE: PlanState = { version: 1, records: [] }

export type NewApplianceInput = { manufacturer: string; model: string; serialNumber: string }

function clean(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function validateNewAppliance(input: NewApplianceInput): string | null {
  return clean(input.manufacturer) ? null : 'Enter the manufacturer, for example Bosch.'
}

function updateRecord(state: PlanState, applianceId: string, update: (r: ApplianceRecord) => ApplianceRecord): PlanState {
  if (!state.records.some((r) => r.appliance.id === applianceId)) throw new Error(`Unknown appliance ${applianceId}`)
  return { ...state, records: state.records.map((r) => (r.appliance.id === applianceId ? update(r) : r)) }
}

export function findRecord(state: PlanState, applianceId: string): ApplianceRecord | undefined {
  return state.records.find((r) => r.appliance.id === applianceId)
}

export function addAppliance(state: PlanState, input: NewApplianceInput, id: string, now: string): PlanState {
  const error = validateNewAppliance(input)
  if (error) throw new Error(error)
  const appliance: Appliance = {
    id,
    category: 'dishwasher',
    manufacturer: clean(input.manufacturer)!,
    model: clean(input.model),
    serialNumber: clean(input.serialNumber),
    createdAt: now,
  }
  const record: ApplianceRecord = {
    appliance,
    recommendations: mockRecommendations(appliance),
    decisions: {},
    tasks: [],
    completions: [],
    approvedAt: null,
  }
  return { ...state, records: [...state.records, record] }
}

export function setDecision(state: PlanState, applianceId: string, recommendationId: string, decision: Decision | null): PlanState {
  return updateRecord(state, applianceId, (r) => {
    if (r.approvedAt) throw new Error('This plan is already approved.')
    const decisions = { ...r.decisions }
    if (decision) decisions[recommendationId] = decision
    else delete decisions[recommendationId]
    return { ...r, decisions }
  })
}

export function approve(
  state: PlanState,
  applianceId: string,
  defaultStartDate: LocalDate,
  newId: () => string,
  now: string,
): PlanState {
  return updateRecord(state, applianceId, (r) => {
    if (r.approvedAt) throw new Error('This plan is already approved.')
    const tasks = approvePlan({ recommendations: r.recommendations, decisions: r.decisions, defaultStartDate, newId })
    return { ...r, tasks, approvedAt: now }
  })
}

export function recordCalendarResults(state: PlanState, applianceId: string, results: readonly WriteResult[]): PlanState {
  return updateRecord(state, applianceId, (r) => ({
    ...r,
    tasks: r.tasks.map((task) => {
      const result = results.find((res) => res.taskId === task.id)
      if (!result?.ok || task.status !== 'approved') return task
      return { ...task, calendarEventId: result.eventId }
    }),
  }))
}

export function addCompletion(state: PlanState, applianceId: string, taskId: string, completedOn: LocalDate): PlanState {
  return updateRecord(state, applianceId, (r) => {
    if (!r.tasks.some((t) => t.id === taskId && t.status === 'approved')) throw new Error('Only approved tasks can be completed.')
    return { ...r, completions: [...r.completions, { taskId, completedOn, notes: null }] }
  })
}

export function removeAppliance(state: PlanState, applianceId: string): PlanState {
  if (!findRecord(state, applianceId)) throw new Error(`Unknown appliance ${applianceId}`)
  return { ...state, records: state.records.filter((r) => r.appliance.id !== applianceId) }
}

export function parseState(raw: string | null): PlanState {
  if (!raw) return EMPTY_STATE
  try {
    const parsed = JSON.parse(raw) as PlanState
    return parsed?.version === 1 && Array.isArray(parsed.records) ? parsed : EMPTY_STATE
  } catch {
    return EMPTY_STATE
  }
}
