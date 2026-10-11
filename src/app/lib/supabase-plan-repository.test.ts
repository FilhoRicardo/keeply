import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { planFallbackReason } from '@/app/components/plan-fallback-banner'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import { createFakeSupabasePlanDb } from './fake-supabase-plan-db'
import { findRecord } from './plan-state'
import { createSupabasePlanRepository } from './supabase-plan-repository'

const input = { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' }

const verified: TaskProposal = {
  name: 'Clean the filter',
  instructions: 'Rinse the filter.',
  interval: { count: 1, unit: 'month' },
  evidenceLevel: 'manufacturer_verified',
  source: {
    type: 'manufacturer_manual',
    title: 'Bosch manual',
    url: 'https://www.bosch-home.com/m.pdf',
    location: 'page 32',
    quote: 'Clean the filter once a month.',
  },
}

const similar: TaskProposal = {
  name: 'Clean the filter',
  instructions: 'Rinse the filter.',
  interval: { count: 1, unit: 'month' },
  evidenceLevel: 'similar_model',
  source: {
    type: 'similar_model_manual',
    title: 'Smeg series manual',
    url: 'https://www.smeg.com/m.pdf',
    location: 'page 18',
    quote: 'Clean the filter once a month.',
    coveredModel: 'DI6012-2',
  },
}

const cases: { name: string; meta: ProposalMeta; proposals: readonly TaskProposal[]; reason: string }[] = [
  { name: 'verified', meta: { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true }, proposals: [verified], reason: 'ok' },
  { name: 'similar-model', meta: { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true }, proposals: [similar], reason: 'ok' },
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
    meta: { fallback: 'general', searchOutcome: 'timeout', searchReason: null, searched: true },
    proposals: GENERAL_DISHWASHER_TASKS,
    reason: 'timeout',
  },
]

function open(db: SupabaseClient) {
  return createSupabasePlanRepository({ db })
}

describe('signed-in plan reason survives a reload', () => {
  it.each(cases)('build $name → reload → same reason', async ({ meta, proposals, reason }) => {
    const db = createFakeSupabasePlanDb()
    const { applianceId, state } = await open(db).addAppliance(input, proposals, meta)
    expect(findRecord(state, applianceId)?.proposalMeta).toEqual(meta)

    const record = findRecord(await open(db).load(), applianceId)
    expect(record?.proposalMeta).toEqual(meta)
    if (reason === 'ok') {
      expect(record?.proposalMeta?.searchOutcome).toBe('ok')
    } else {
      expect(planFallbackReason(record?.proposalMeta ?? null)).toBe(reason)
    }
  })

  it('keeps a plan saved with no reason as no reason', async () => {
    const db = createFakeSupabasePlanDb()
    const { applianceId } = await open(db).addAppliance(input, GENERAL_DISHWASHER_TASKS)
    const record = findRecord(await open(db).load(), applianceId)
    expect(record?.proposalMeta).toBeNull()
    expect(planFallbackReason(record?.proposalMeta ?? null)).toBe('no_proposal_meta')
  })
})
