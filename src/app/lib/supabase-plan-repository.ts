import type { SupabaseClient } from '@supabase/supabase-js'
import {
  addAppliance,
  approvePlan,
  decideTask,
  deleteAppliance,
  loadApplianceTree,
  loadApplianceTrees,
  setCalendarEventId,
} from '@/db/queries'
import { toApplianceRecord } from '@/db/rows'
import { approvalBlockers } from '@/domain/plan'
import type { ProposalMeta } from '@/domain/model'
import type { PlanRepository } from './plan-repository'
import { validateNewAppliance, type PlanState } from './plan-state'

// Stored provenance wins. This map only fills a row that came back empty inside the same
// repository instance, so the plan just saved can still name its reason if that read missed
// the column. A reload builds a new repository and reads proposal_meta from the appliance.
export function rememberProposalMeta(state: PlanState, remembered: ReadonlyMap<string, ProposalMeta>): PlanState {
  if (remembered.size === 0) return state
  let changed = false
  const records = state.records.map((record) => {
    if (record.proposalMeta) return record
    const meta = remembered.get(record.appliance.id)
    if (!meta) return record
    changed = true
    return { ...record, proposalMeta: meta }
  })
  return changed ? { ...state, records } : state
}

// PlanRepository backed by Supabase. `ensureSession` signs the visitor in (anonymously until they
// sign in with Google) before the first call; row-level security and the schema's rules do the rest.
export function createSupabasePlanRepository({
  db,
  ensureSession = async () => {},
  now = () => new Date().toISOString(),
}: {
  db: SupabaseClient
  ensureSession?: () => Promise<void>
  now?: () => string
}): PlanRepository {
  let session: Promise<void> | null = null
  const rememberedMeta = new Map<string, ProposalMeta>()
  // Shared only while in flight: after a sign-out the next call starts a fresh session.
  const ready = () => (session ??= ensureSession().finally(() => (session = null)))

  async function load(): Promise<PlanState> {
    await ready()
    return rememberProposalMeta({ version: 2, records: (await loadApplianceTrees(db)).map(toApplianceRecord) }, rememberedMeta)
  }

  return {
    kind: 'supabase',
    load,
    async accessToken() {
      await ready()
      const { data } = await db.auth.getSession()
      return data.session?.access_token ?? null
    },
    async addAppliance(input, proposals, meta: ProposalMeta | null = null) {
      const error = validateNewAppliance(input)
      if (error) throw new Error(error)
      await ready()
      const applianceId = await addAppliance(
        db,
        { manufacturer: input.manufacturer.trim(), model: input.model, serialNumber: input.serialNumber, confidence: input.confidence ?? null },
        proposals,
        meta,
      )
      if (meta) rememberedMeta.set(applianceId, meta)
      return { state: await load(), applianceId }
    },
    async decide(_applianceId, taskId, decision) {
      await ready()
      await decideTask(db, taskId, decision)
      return load()
    },
    async approve(applianceId, startDate) {
      await ready()
      // Same rules as the database, checked first for a clear message.
      const tree = await loadApplianceTree(db, applianceId)
      if (!tree) throw new Error(`Unknown appliance ${applianceId}`)
      const record = toApplianceRecord(tree)
      if (record.approvedAt) throw new Error('This plan is already approved.')
      const blockers = approvalBlockers(record.tasks)
      if (blockers.length > 0) throw new Error(`Plan cannot be approved: ${blockers.join(', ')}`)
      await approvePlan(db, applianceId, startDate, now())
      return load()
    },
    async recordCalendarResults(_applianceId, results) {
      await ready()
      await Promise.all(results.flatMap((r) => (r.ok ? [setCalendarEventId(db, r.taskId, r.eventId)] : [])))
      return load()
    },
    async deleteAppliance(applianceId) {
      await ready()
      rememberedMeta.delete(applianceId)
      await deleteAppliance(db, applianceId)
      return load()
    },
  }
}
