import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addApplianceWithRecommendations,
  deleteAppliance,
  insertApprovedTasks,
  insertCompletion,
  loadApplianceTrees,
  saveDecision,
  setCalendarEventId,
  toDecision,
  type ApplianceTree,
} from '@/db/plan-queries'
import { toAppliance, toCompletion, toRecommendation, toTask } from '@/db/rows'
import { GENERAL_DISHWASHER_GUIDANCE, mockRecommendations } from '@/domain/mock-recommendations'
import { approvePlan, type Decisions } from '@/domain/plan'
import type { PlanRepository } from './plan-repository'
import { findRecord, validateNewAppliance, type ApplianceRecord, type PlanState } from './plan-state'

export function toApplianceRecord(tree: ApplianceTree): ApplianceRecord {
  const sources = new Map(tree.source_documents.map((s) => [s.id, s]))
  const recommendations = [...tree.maintenance_recommendations]
    .sort((a, b) => a.position - b.position)
    .map((r) => toRecommendation(r, sources.get(r.source_document_id)!))
  const order = new Map(recommendations.map((r, i) => [r.id, i]))
  const tasks = [...tree.maintenance_tasks].sort((a, b) => order.get(a.recommendation_id)! - order.get(b.recommendation_id)!)
  const decisions: Decisions = Object.fromEntries(tree.plan_decisions.map((d) => [d.recommendation_id, toDecision(d)]))
  return {
    appliance: toAppliance(tree),
    recommendations,
    decisions,
    tasks: tasks.map(toTask),
    completions: tasks.flatMap((t) => t.maintenance_completions.map(toCompletion)),
    approvedAt: tasks.map((t) => t.approved_at).find((a): a is string => a !== null) ?? null,
  }
}

// PlanRepository backed by Supabase. `ensureSession` signs the visitor in (anonymously in v0.1)
// before the first call; row-level security does the rest.
export function createSupabasePlanRepository({
  db,
  ensureSession = async () => {},
  newId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
}: {
  db: SupabaseClient
  ensureSession?: () => Promise<void>
  newId?: () => string
  now?: () => string
}): PlanRepository {
  let session: Promise<void> | null = null
  const ready = () => (session ??= ensureSession().catch((e) => ((session = null), Promise.reject(e))))

  async function load(): Promise<PlanState> {
    await ready()
    return { version: 1, records: (await loadApplianceTrees(db)).map(toApplianceRecord) }
  }

  async function record(applianceId: string): Promise<ApplianceRecord> {
    const found = findRecord(await load(), applianceId)
    if (!found) throw new Error(`Unknown appliance ${applianceId}`)
    return found
  }

  return {
    kind: 'supabase',
    load,
    async accessToken() {
      await ready()
      const { data } = await db.auth.getSession()
      return data.session?.access_token ?? null
    },
    async addAppliance(input) {
      const error = validateNewAppliance(input)
      if (error) throw new Error(error)
      await ready()
      const applianceId = await addApplianceWithRecommendations(
        db,
        input,
        GENERAL_DISHWASHER_GUIDANCE,
        mockRecommendations({ id: 'new' }),
      )
      return { state: await load(), applianceId }
    },
    async setDecision(applianceId, recommendationId, decision) {
      await ready()
      await saveDecision(db, applianceId, recommendationId, decision)
      return load()
    },
    async approve(applianceId, defaultStartDate) {
      const current = await record(applianceId)
      if (current.approvedAt) throw new Error('This plan is already approved.')
      const tasks = approvePlan({
        recommendations: current.recommendations,
        decisions: current.decisions,
        defaultStartDate,
        newId,
      })
      await insertApprovedTasks(db, tasks, now())
      return load()
    },
    async recordCalendarResults(applianceId, results) {
      await ready()
      for (const result of results) if (result.ok) await setCalendarEventId(db, result.taskId, result.eventId)
      return load()
    },
    async deleteAppliance(applianceId) {
      await ready()
      await deleteAppliance(db, applianceId)
      return load()
    },
    async addCompletion(applianceId, taskId, completedOn) {
      const current = await record(applianceId)
      if (!current.tasks.some((t) => t.id === taskId && t.status === 'approved')) {
        throw new Error('Only approved tasks can be completed.')
      }
      await insertCompletion(db, taskId, completedOn)
      return load()
    },
  }
}
