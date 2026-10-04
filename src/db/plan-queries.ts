import type { SupabaseClient } from '@supabase/supabase-js'
import type { Recommendation, SourceDocument, Task } from '@/domain/model'
import type { Customisation, Decision } from '@/domain/plan'
import { fromTask, type ApplianceRow, type CompletionRow, type RecommendationRow, type SourceDocumentRow, type TaskRow } from './rows'

// All Keeply plan reads and writes against Supabase. Every call runs as the signed-in user,
// so row-level security scopes it to their own homes.

export type DecisionRow = {
  recommendation_id: string
  appliance_id: string
  kind: Decision['kind']
  interval_count: number | null
  interval_unit: Customisation['interval']['unit'] | null
  start_date: string | null
  scheduling_mode: Customisation['schedulingMode'] | null
}

export type ApplianceTree = ApplianceRow & {
  source_documents: SourceDocumentRow[]
  maintenance_recommendations: (RecommendationRow & { position: number })[]
  maintenance_tasks: (TaskRow & { maintenance_completions: CompletionRow[] })[]
  plan_decisions: DecisionRow[]
}

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(`Supabase: ${error.message}`)
  return data as T
}

const TREE = '*, source_documents(*), maintenance_recommendations(*), maintenance_tasks(*, maintenance_completions(*)), plan_decisions(*)'

export async function loadApplianceTrees(db: SupabaseClient): Promise<ApplianceTree[]> {
  return check(await db.from('appliances').select(TREE).order('created_at')) as ApplianceTree[]
}

// One appliance, or null if it does not exist or belongs to someone else (RLS).
export async function loadApplianceTree(db: SupabaseClient, applianceId: string): Promise<ApplianceTree | null> {
  return check(await db.from('appliances').select(TREE).eq('id', applianceId).maybeSingle()) as ApplianceTree | null
}

export type NewRecommendation = Pick<Recommendation, 'taskName' | 'description' | 'recommendedInterval' | 'evidenceLevel' | 'sourceLocation'>

export async function addApplianceWithRecommendations(
  db: SupabaseClient,
  input: { manufacturer: string; model: string; serialNumber: string },
  source: Omit<SourceDocument, 'id'>,
  recommendations: readonly NewRecommendation[],
  confidence: number | null = null,
): Promise<string> {
  const result = await db.rpc('add_appliance_with_recommendations', {
    p_manufacturer: input.manufacturer.trim(),
    p_model: input.model,
    p_serial_number: input.serialNumber,
    p_identification_confidence: confidence,
    p_source: {
      source_type: source.sourceType,
      title: source.title,
      reference: source.reference,
      manufacturer: source.manufacturer,
      model_scope: source.modelScope,
    },
    p_recommendations: recommendations.map((r) => ({
      task_name: r.taskName,
      description: r.description,
      interval_count: r.recommendedInterval.count,
      interval_unit: r.recommendedInterval.unit,
      evidence_level: r.evidenceLevel,
      source_location: r.sourceLocation,
    })),
  })
  return check(result) as string
}

export function toDecisionRow(applianceId: string, recommendationId: string, decision: Decision): DecisionRow {
  const custom = decision.kind === 'customise' ? decision : null
  return {
    recommendation_id: recommendationId,
    appliance_id: applianceId,
    kind: decision.kind,
    interval_count: custom?.interval.count ?? null,
    interval_unit: custom?.interval.unit ?? null,
    start_date: custom?.startDate ?? null,
    scheduling_mode: custom?.schedulingMode ?? null,
  }
}

export function toDecision(row: DecisionRow): Decision {
  if (row.kind !== 'customise') return { kind: row.kind }
  return {
    kind: 'customise',
    interval: { count: row.interval_count!, unit: row.interval_unit! },
    startDate: row.start_date!,
    schedulingMode: row.scheduling_mode!,
  }
}

export async function saveDecision(db: SupabaseClient, applianceId: string, recommendationId: string, decision: Decision | null) {
  const result = decision
    ? await db.from('plan_decisions').upsert(toDecisionRow(applianceId, recommendationId, decision))
    : await db.from('plan_decisions').delete().eq('recommendation_id', recommendationId)
  check(result)
}

// Inserts every Task from one Approval in a single statement, so approval is all-or-nothing.
export async function insertApprovedTasks(db: SupabaseClient, tasks: readonly Task[], approvedAt: string) {
  check(await db.from('maintenance_tasks').insert(tasks.map((t) => fromTask(t, approvedAt))))
}

export async function setCalendarEventId(db: SupabaseClient, taskId: string, eventId: string) {
  check(await db.from('maintenance_tasks').update({ calendar_event_id: eventId }).eq('id', taskId).eq('status', 'approved'))
}

export async function updateTaskSchedule(db: SupabaseClient, task: Task) {
  check(
    await db
      .from('maintenance_tasks')
      .update({
        user_interval_count: task.userInterval.count,
        user_interval_unit: task.userInterval.unit,
        start_date: task.startDate,
        scheduling_mode: task.schedulingMode,
      })
      .eq('id', task.id)
      .eq('status', 'approved'),
  )
}

export const PHOTO_BUCKET = 'appliance-photos'

// Uploads the label photo to the owner's folder (RLS on storage.objects) and links it.
export async function attachPhoto(db: SupabaseClient, userId: string, applianceId: string, photo: Blob): Promise<string> {
  const path = `${userId}/${applianceId}.jpg`
  const upload = await db.storage.from(PHOTO_BUCKET).upload(path, photo, { contentType: photo.type || 'image/jpeg', upsert: true })
  if (upload.error) throw new Error(`Supabase storage: ${upload.error.message}`)
  check(await db.from('appliances').update({ image_url: path }).eq('id', applianceId))
  return path
}

// Short-lived URLs for private photos, keyed by storage path.
export async function signPhotoUrls(db: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map()
  const { data, error } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600)
  if (error || !data) return new Map()
  const urls = new Map<string, string>()
  for (const d of data) if (d.path && d.signedUrl) urls.set(d.path, d.signedUrl)
  return urls
}

// Cascades to sources, recommendations, decisions, tasks and completions.
export async function deleteAppliance(db: SupabaseClient, applianceId: string) {
  const { data, error } = await db.from('appliances').delete().eq('id', applianceId).select('id')
  if (error) throw new Error(`Supabase: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`Unknown appliance ${applianceId}`)
}

export async function insertCompletion(db: SupabaseClient, taskId: string, completedOn: string) {
  check(await db.from('maintenance_completions').insert({ maintenance_task_id: taskId, completed_on: completedOn }))
}
