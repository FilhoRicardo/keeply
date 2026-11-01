import type { PlanSearchOutcome } from '../api/plan/orchestration'

// One counts-only line per /api/plan call. No URLs, document text, user ids, or keys.
export type PlanRunLog = {
  type: 'plan_run'
  braveStatus: readonly number[]
  candidates: number
  coverMatches: number
  aiTasks: number
  quotePass: number
  outcome: PlanSearchOutcome
  timedOut: boolean
  elapsedMs: number
}

export function logPlanRun(entry: PlanRunLog): void {
  console.log(JSON.stringify(entry))
}
