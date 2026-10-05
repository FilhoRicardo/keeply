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
  // Shared only while in flight: after a sign-out the next call starts a fresh session.
  const ready = () => (session ??= ensureSession().finally(() => (session = null)))

  async function load(): Promise<PlanState> {
    await ready()
    return { version: 2, records: (await loadApplianceTrees(db)).map(toApplianceRecord) }
  }

  return {
    kind: 'supabase',
    load,
    async accessToken() {
      await ready()
      const { data } = await db.auth.getSession()
      return data.session?.access_token ?? null
    },
    async addAppliance(input, proposals, _meta?: ProposalMeta | null) {
      // KEE-43: the Supabase adapter does not persist proposalMeta yet (no column). The plan
      // page falls back to a generic banner in that case. The live proposer still runs; the
      // outcome is recorded in the funnel event by the orchestration's `plan_search` write.
      void _meta
      const error = validateNewAppliance(input)
      if (error) throw new Error(error)
      await ready()
      const applianceId = await addAppliance(
        db,
        { manufacturer: input.manufacturer.trim(), model: input.model, serialNumber: input.serialNumber, confidence: input.confidence ?? null },
        proposals,
      )
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
      await deleteAppliance(db, applianceId)
      return load()
    },
  }
}
