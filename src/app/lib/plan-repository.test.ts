import { describe, expect, it } from 'vitest'
import { GENERAL_DISHWASHER_TASKS } from '@/domain/general-guidance'
import type { ProposalMeta } from '@/domain/model'
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

  it.each<{ name: string; meta: ProposalMeta }>([
    { name: 'verified', meta: { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true } },
    { name: 'similar-model', meta: { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true } },
    { name: 'general-guidance', meta: { fallback: 'general', searchOutcome: 'no_results', searchReason: null, searched: true } },
    { name: 'extraction-unavailable', meta: { fallback: 'general', searchOutcome: 'extraction_unavailable', searchReason: null, searched: true } },
    { name: 'timeout', meta: { fallback: 'general', searchOutcome: 'timeout', searchReason: null, searched: true } },
  ])('keeps the $name reason when a new repository reloads storage', async ({ meta }) => {
    const storage = memoryStorage()
    const repo = createDevicePlanRepository({ storage, newId: ids(), now: () => 'now' })
    const { applianceId } = await repo.addAppliance(input, proposals, meta)
    const reopened = createDevicePlanRepository({ storage })
    expect(findRecord(await reopened.load(), applianceId)?.proposalMeta).toEqual(meta)
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
