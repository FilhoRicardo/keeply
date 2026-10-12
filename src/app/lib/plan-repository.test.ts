import { describe, expect, it } from 'vitest'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import { planFallbackReason } from '../components/plan-fallback-banner'
import { createDevicePlanRepository, DEVICE_STORAGE_KEY, memoryStorage } from './plan-repository'
import { findRecord } from './plan-state'

function ids() {
  let n = 0
  return () => `id-${++n}`
}

const input = { manufacturer: 'Bosch', model: '', serialNumber: '' }
const proposals = GENERAL_DISHWASHER_TASKS

describe('device plan repository', () => {
  it('persists to storage and reloads in a new repository', async () => {
    const storage = memoryStorage()
    const repo = createDevicePlanRepository({ storage, newId: ids(), now: () => 'now' })
    const { applianceId } = await repo.addAppliance(input, proposals)

    const reopened = createDevicePlanRepository({ storage })
    expect(findRecord(await reopened.load(), applianceId)?.appliance.manufacturer).toBe('Bosch')
  })

  it('runs the plan lifecycle through the interface', async () => {
    const repo = createDevicePlanRepository({ storage: memoryStorage(), newId: ids(), now: () => 'now' })
    const { applianceId, state } = await repo.addAppliance(input, proposals)
    const [first, ...rest] = findRecord(state, applianceId)!.tasks
    await repo.decide(applianceId, first.id, 'accepted')
    for (const t of rest) await repo.decide(applianceId, t.id, 'rejected')

    await repo.approve(applianceId, '2026-10-05')
    const done = await repo.recordCalendarResults(applianceId, [{ taskId: first.id, ok: true, eventId: 'evt' }])

    const record = findRecord(done, applianceId)!
    expect(record).toMatchObject({ approvedAt: 'now', startDate: '2026-10-05' })
    expect(record.tasks.map((t) => [t.status, t.calendarEventId])).toEqual([
      ['accepted', 'evt'],
      ['rejected', null],
      ['rejected', null],
    ])
  })

  it('keeps an unsaved change when storage reads work but writes fail (quota)', async () => {
    const backing = memoryStorage()
    const full = {
      getItem: backing.getItem,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const repo = createDevicePlanRepository({ storage: full, newId: ids(), now: () => 'now' })
    const { applianceId, state } = await repo.addAppliance(input, proposals)
    const task = findRecord(state, applianceId)!.tasks[0]

    const next = await repo.decide(applianceId, task.id, 'accepted')
    expect(findRecord(next, applianceId)?.tasks[0].status).toBe('accepted')
  })

  it('keeps working in memory when storage throws', async () => {
    const broken = {
      getItem: () => {
        throw new Error('SecurityError')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    const repo = createDevicePlanRepository({ storage: broken, newId: ids() })
    const { applianceId } = await repo.addAppliance(input, proposals)
    expect(findRecord(await repo.load(), applianceId)).toBeDefined()
  })

  it('works with no storage at all', async () => {
    const repo = createDevicePlanRepository({ storage: null, newId: ids() })
    await repo.addAppliance(input, proposals)
    expect((await repo.load()).records).toHaveLength(1)
  })

  it('ignores corrupt stored data', async () => {
    const repo = createDevicePlanRepository({ storage: memoryStorage({ [DEVICE_STORAGE_KEY]: '{oops' }) })
    expect((await repo.load()).records).toEqual([])
  })
})

describe('device plan reload', () => {
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
      proposals: [{ ...verified, evidenceLevel: 'similar_model', source: { ...verified.source, type: 'similar_model_manual' } }],
      reason: 'no_search_key',
    },
    {
      name: 'general-guidance',
      meta: { fallback: 'general', searchOutcome: 'no_results', searchReason: null, searched: true },
      proposals,
      reason: 'no_results',
    },
    {
      name: 'extraction-unavailable',
      meta: { fallback: 'general', searchOutcome: 'extraction_unavailable', searchReason: null, searched: true },
      proposals,
      reason: 'extraction_unavailable',
    },
    {
      name: 'timeout',
      meta: { fallback: 'general', searchOutcome: 'timeout', searchReason: null, searched: true },
      proposals,
      reason: 'timeout',
    },
  ]

  it.each(cases)('keeps the $name reason after a reload', async ({ meta, proposals: tasks, reason }) => {
    const storage = memoryStorage()
    const repo = createDevicePlanRepository({ storage, newId: ids(), now: () => 'now' })
    const { applianceId } = await repo.addAppliance(input, tasks, meta)
    const reloaded = createDevicePlanRepository({ storage })
    const record = findRecord(await reloaded.load(), applianceId)
    expect(record?.proposalMeta).toEqual(meta)
    expect(planFallbackReason(record?.proposalMeta ?? null)).toBe(reason)
  })
})

describe('deleteAppliance', () => {
  it('removes only that appliance', async () => {
    const repo = createDevicePlanRepository({ storage: memoryStorage(), newId: ids() })
    const { applianceId: a } = await repo.addAppliance(input, proposals)
    const { applianceId: b } = await repo.addAppliance(input, proposals)
    const state = await repo.deleteAppliance(a)
    expect(state.records.map((r) => r.appliance.id)).toEqual([b])
    await expect(repo.deleteAppliance(a)).rejects.toThrow(/Unknown appliance/)
  })
})
