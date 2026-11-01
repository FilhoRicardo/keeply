import type { SupabaseClient } from '@supabase/supabase-js'
import type { LocalDate } from '@/domain/dates'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import type { Decision } from '@/domain/plan'
import { proposalMetaForStorage } from '@/app/lib/plan-search-outcomes'
import { fromProposal, type ApplianceTree } from './rows'

// Every Keeply read and write against Supabase. Each call runs as the signed-in user, so
// row-level security scopes it to their own appliances. add_appliance also stores the
// proposer's outcome (RF-352) so a reload can show the same plan banner.

function check<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(`Supabase: ${error.message}`)
  return data as T
}

const TREE = '*, maintenance_tasks(*)'

export async function loadApplianceTrees(db: SupabaseClient): Promise<ApplianceTree[]> {
  return check(await db.from('appliances').select(TREE).order('created_at')) as ApplianceTree[]
}

// One dishwasher, or null if it does not exist or belongs to someone else (RLS).
export async function loadApplianceTree(db: SupabaseClient, applianceId: string): Promise<ApplianceTree | null> {
  return check(await db.from('appliances').select(TREE).eq('id', applianceId).maybeSingle()) as ApplianceTree | null
}

export type NewAppliance = { manufacturer: string; model: string; serialNumber: string; confidence: number | null }

// One transaction: the dishwasher never exists without its proposed tasks.
export async function addAppliance(
  db: SupabaseClient,
  input: NewAppliance,
  proposals: readonly TaskProposal[],
  meta: ProposalMeta | null = null,
): Promise<string> {
  return check(
    await db.rpc('add_appliance', {
      p_manufacturer: input.manufacturer,
      p_model: input.model,
      p_serial_number: input.serialNumber,
      p_identification_confidence: input.confidence,
      p_tasks: proposals.map(fromProposal),
      p_proposal_meta: meta ? proposalMetaForStorage(meta) : null,
    }),
  ) as string
}

// The database refuses this after Approval.
export async function decideTask(db: SupabaseClient, taskId: string, decision: Decision | null) {
  const { data, error } = await db.from('maintenance_tasks').update({ status: decision ?? 'proposed' }).eq('id', taskId).select('id')
  if (error) throw new Error(`Supabase: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`Unknown task ${taskId}`)
}

// The database checks every task is decided and one is accepted.
export async function approvePlan(db: SupabaseClient, applianceId: string, startDate: LocalDate, now: string) {
  const { data, error } = await db
    .from('appliances')
    .update({ approved_at: now, start_date: startDate })
    .eq('id', applianceId)
    .is('approved_at', null)
    .select('id')
  if (error) throw new Error(`Supabase: ${error.message}`)
  if (!data || data.length === 0) throw new Error('This plan is already approved.')
}

export async function setCalendarEventId(db: SupabaseClient, taskId: string, eventId: string) {
  check(await db.from('maintenance_tasks').update({ calendar_event_id: eventId }).eq('id', taskId).eq('status', 'accepted'))
}

// Cascades to its tasks. Events already in the owner's calendar stay there.
export async function deleteAppliance(db: SupabaseClient, applianceId: string) {
  const { data, error } = await db.from('appliances').delete().eq('id', applianceId).select('id')
  if (error) throw new Error(`Supabase: ${error.message}`)
  if (!data || data.length === 0) throw new Error(`Unknown appliance ${applianceId}`)
}
