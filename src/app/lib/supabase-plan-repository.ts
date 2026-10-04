import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addApplianceWithRecommendations,
  attachPhoto,
  clearCalendarEventIds,
  setTaskStatus,
  signPhotoUrls,
  deleteAppliance,
  updateTaskSchedule,
  insertApprovedTasks,
  insertCompletion,
  loadCatalog,
  loadApplianceTree,
  loadApplianceTrees,
  saveDecision,
  setCalendarEventId,
  toDecision,
  type ApplianceTree,
} from '@/db/plan-queries'
import { toAppliance, toCompletion, toRecommendation, toTask } from '@/db/rows'
import { proposeRecommendations } from '@/domain/guidance'
import { GENERAL_DISHWASHER_GUIDANCE } from '@/domain/mock-recommendations'
import { approvePlan, rescheduleTask, type Decisions } from '@/domain/plan'
import { dataUrlToBlob, type PlanRepository } from './plan-repository'
import { validateNewAppliance, type ApplianceRecord, type PlanState } from './plan-state'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
    const trees = await loadApplianceTrees(db)
    const urls = await signPhotoUrls(db, trees.map((t) => t.image_url).filter((p): p is string => Boolean(p)))
    const records = trees.map((tree) => {
      const record = toApplianceRecord(tree)
      const imageUrl = tree.image_url ? (urls.get(tree.image_url) ?? null) : null
      return imageUrl ? { ...record, appliance: { ...record.appliance, imageUrl } } : record
    })
    return { version: 1, records }
  }

  // One appliance for validating a mutation: no other appliances, no photo signing.
  async function record(applianceId: string): Promise<ApplianceRecord> {
    await ready()
    const tree = await loadApplianceTree(db, applianceId)
    if (!tree) throw new Error(`Unknown appliance ${applianceId}`)
    return toApplianceRecord(tree)
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
      const catalog = await loadCatalog(db, input.manufacturer)
      const proposed = proposeRecommendations({ id: 'new', manufacturer: input.manufacturer, model: input.model.trim() || null }, catalog)
      const applianceId = await addApplianceWithRecommendations(
        db,
        input,
        GENERAL_DISHWASHER_GUIDANCE,
        proposed,
        input.confidence ?? null,
      )
      if (input.photo) {
        const { data } = await db.auth.getSession()
        const userId = data.session?.user.id
        // A failed photo upload does not lose the appliance; it simply has no photo.
        if (userId) await attachPhoto(db, userId, applianceId, input.photo).catch(() => {})
      }
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
      await Promise.all(results.flatMap((r) => (r.ok ? [setCalendarEventId(db, r.taskId, r.eventId)] : [])))
      return load()
    },
    async updateTaskSchedule(applianceId, taskId, schedule) {
      const task = (await record(applianceId)).tasks.find((t) => t.id === taskId)
      if (!task) throw new Error(`Unknown task ${taskId}`)
      await updateTaskSchedule(db, rescheduleTask(task, schedule))
      return load()
    },
    async setTaskPaused(applianceId, taskId, paused) {
      await record(applianceId)
      await setTaskStatus(db, taskId, paused ? 'approved' : 'paused', paused ? 'paused' : 'approved')
      return load()
    },
    async clearCalendarEvents(applianceId, taskIds) {
      await ready()
      await clearCalendarEventIds(db, taskIds)
      return load()
    },
    async importRecord(source) {
      await ready()
      const { appliance } = source
      const applianceId = await addApplianceWithRecommendations(
        db,
        { manufacturer: appliance.manufacturer, model: appliance.model ?? '', serialNumber: appliance.serialNumber ?? '' },
        GENERAL_DISHWASHER_GUIDANCE,
        source.recommendations,
        appliance.identificationConfidence,
      )
      // All or nothing: a half-imported appliance stays on the device, so a retry would duplicate it
      // (and collide on the kept task ids). Remove what was created before rethrowing.
      try {
        const tree = await loadApplianceTree(db, applianceId)
        if (!tree) throw new Error('Imported appliance could not be read back.')
        const created = toApplianceRecord(tree).recommendations
        const recId = new Map(source.recommendations.map((r, i) => [r.id, created[i].id]))

        // Decisions first: they freeze once tasks exist.
        for (const [oldId, decision] of Object.entries(source.decisions)) {
          const mapped = recId.get(oldId)
          if (mapped) await saveDecision(db, applianceId, mapped, decision)
        }
        if (source.approvedAt && source.tasks.length > 0) {
          const taskId = new Map(source.tasks.map((t) => [t.id, UUID.test(t.id) ? t.id : newId()]))
          await insertApprovedTasks(
            db,
            source.tasks.map((t) => ({
              ...t,
              id: taskId.get(t.id)!,
              applianceId,
              recommendationId: recId.get(t.recommendationId)!,
              // A new id means a new calendar event id; drop the old link rather than point at the wrong event.
              calendarEventId: taskId.get(t.id) === t.id ? t.calendarEventId : null,
            })),
            source.approvedAt,
          )
          for (const c of source.completions) {
            const mapped = taskId.get(c.taskId)
            if (mapped) await insertCompletion(db, mapped, c.completedOn, c.notes)
          }
        }
      } catch (e) {
        await deleteAppliance(db, applianceId).catch(() => {})
        throw e
      }
      // The photo is best effort, like addAppliance: a failure never loses the appliance.
      if (appliance.imageUrl?.startsWith('data:')) {
        try {
          const { data } = await db.auth.getSession()
          const userId = data.session?.user.id
          if (userId) await attachPhoto(db, userId, applianceId, dataUrlToBlob(appliance.imageUrl))
        } catch {
          // Keep the imported plan without its photo.
        }
      }
    },
    async deleteAppliance(applianceId) {
      await ready()
      await deleteAppliance(db, applianceId)
      return load()
    },
    async addCompletion(applianceId, taskId, completedOn, notes) {
      const current = await record(applianceId)
      if (!current.tasks.some((t) => t.id === taskId && t.status === 'approved')) {
        throw new Error('Only approved tasks can be completed.')
      }
      await insertCompletion(db, taskId, completedOn, notes?.trim() || null)
      return load()
    },
  }
}
