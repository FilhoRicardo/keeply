import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { fromProposal, type ApplianceTree, type TaskRow } from '@/db/rows'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import { planFallbackReason } from '../components/plan-fallback-banner'
import { findRecord } from './plan-state'
import { createSupabasePlanRepository } from './supabase-plan-repository'

// A page reload builds a new repository. The fake keeps whatever add_appliance was given,
// the way Postgres keeps proposal_meta, so this fails if the save or the load drops it.

const verified: TaskProposal = {
  name: 'Clean the filter',
  instructions: 'Rinse it.',
  interval: { count: 1, unit: 'month' },
  evidenceLevel: 'manufacturer_verified',
  source: {
    type: 'manufacturer_manual',
    title: 'Manual',
    url: 'https://www.bosch-home.com/m.pdf',
    location: 'p. 32',
    quote: 'Clean the filters.',
  },
}

const similar: TaskProposal = {
  name: 'Clean the filter',
  instructions: 'Rinse it.',
  interval: { count: 1, unit: 'month' },
  evidenceLevel: 'similar_model',
  source: {
    type: 'similar_model_manual',
    title: 'Smeg DI6012 series',
    url: 'https://www.smeg.com/di6012.pdf',
    location: 'page 18',
    quote: 'Clean the filter once a month.',
  },
}

const input = { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' }

function taskRows(applianceId: string, payloads: ReturnType<typeof fromProposal>[]): TaskRow[] {
  return payloads.map((payload, index) => ({
    id: `${applianceId}-${index + 1}`,
    appliance_id: applianceId,
    position: index + 1,
    name: payload.name,
    instructions: payload.instructions,
    interval_count: payload.interval_count,
    interval_unit: payload.interval_unit,
    evidence_level: payload.evidence_level,
    source_type: payload.source_type,
    source_title: payload.source_title,
    source_url: payload.source_url,
    source_location: payload.source_location,
    source_quote: payload.source_quote,
    status: 'proposed',
    calendar_event_id: null,
    created_at: '2026-10-11T00:00:00Z',
  }))
}

function fakeDb(initial: ApplianceTree[] = []) {
  const rows = [...initial]
  let n = 0
  const db = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn !== 'add_appliance') return { data: null, error: { message: `unexpected ${fn}` } }
      n += 1
      const id = `app-${n}`
      rows.push({
        id,
        user_id: 'user-1',
        manufacturer: String(args.p_manufacturer).trim(),
        model: String(args.p_model ?? '').trim() || null,
        serial_number: String(args.p_serial_number ?? '').trim() || null,
        identification_confidence: (args.p_identification_confidence as number | null) ?? null,
        approved_at: null,
        start_date: null,
        created_at: '2026-10-11T00:00:00Z',
        proposal_meta: Object.prototype.hasOwnProperty.call(args, 'p_proposal_meta') ? args.p_proposal_meta : null,
        maintenance_tasks: taskRows(id, args.p_tasks as ReturnType<typeof fromProposal>[]),
      })
      return { data: id, error: null }
    },
    from() {
      return {
        select() {
          return { order: async () => ({ data: rows, error: null }) }
        },
      }
    },
  }
  return db as unknown as SupabaseClient
}

const cases: { name: string; meta: ProposalMeta; proposals: readonly TaskProposal[]; reason: string }[] = [
  {
    name: 'verified',
    meta: { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true },
    proposals: [verified],
    reason: 'no_search_key',
  },
  {
    name: 'similar-model',
    meta: { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true },
    proposals: [similar],
    reason: 'no_search_key',
  },
  {
    name: 'general-guidance',
    meta: { fallback: 'general', searchOutcome: 'no_results', searchReason: null, searched: true },
    proposals: GENERAL_DISHWASHER_TASKS,
    reason: 'no_results',
  },
  {
    name: 'extraction-unavailable',
    meta: { fallback: 'general', searchOutcome: 'extraction_unavailable', searchReason: null, searched: true },
    proposals: GENERAL_DISHWASHER_TASKS,
    reason: 'extraction_unavailable',
  },
  {
    name: 'timeout',
    meta: { fallback: 'general', searchOutcome: 'timeout', searchReason: 'timeout', searched: true },
    proposals: GENERAL_DISHWASHER_TASKS,
    reason: 'timeout',
  },
]

describe('signed-in plan reload', () => {
  it.each(cases)('keeps the $name reason after a new repository loads the plan', async ({ meta, proposals, reason }) => {
    const db = fakeDb()
    const built = createSupabasePlanRepository({ db })
    const { applianceId } = await built.addAppliance(input, proposals, meta)

    const reloaded = createSupabasePlanRepository({ db })
    const record = findRecord(await reloaded.load(), applianceId)
    expect(record?.proposalMeta).toEqual(meta)
    expect(planFallbackReason(record?.proposalMeta ?? null)).toBe(reason)
  })

  it('loads an older appliance with no provenance as unknown', async () => {
    const db = fakeDb([
      {
        id: 'app-old',
        user_id: 'user-1',
        manufacturer: 'Bosch',
        model: 'OLD',
        serial_number: null,
        identification_confidence: null,
        approved_at: null,
        start_date: null,
        created_at: '2026-10-01T00:00:00Z',
        proposal_meta: null,
        maintenance_tasks: taskRows('app-old', GENERAL_DISHWASHER_TASKS.map(fromProposal)),
      },
    ])
    const record = findRecord(await createSupabasePlanRepository({ db }).load(), 'app-old')
    expect(record?.proposalMeta).toBeNull()
    expect(planFallbackReason(record?.proposalMeta ?? null)).toBe('no_proposal_meta')
  })
})
