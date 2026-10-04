import { describe, expect, it } from 'vitest'
import { findRecord } from './plan-state'
import { createDevicePlanRepository, DEVICE_STORAGE_KEY, memoryStorage } from './plan-repository'

function ids() {
  let n = 0
  return () => `id-${++n}`
}

const input = { manufacturer: 'Bosch', model: '', serialNumber: '' }

describe('device plan repository', () => {
  it('persists to storage and reloads in a new repository', async () => {
    const storage = memoryStorage()
    const repo = createDevicePlanRepository({ storage, newId: ids(), now: () => 'now' })
    const { applianceId } = await repo.addAppliance(input)

    const reopened = createDevicePlanRepository({ storage })
    expect(findRecord(await reopened.load(), applianceId)?.appliance.manufacturer).toBe('Bosch')
  })

  it('runs the full plan lifecycle through the interface', async () => {
    const repo = createDevicePlanRepository({ storage: memoryStorage(), newId: ids(), now: () => 'now' })
    const { applianceId, state } = await repo.addAppliance(input)
    const recs = findRecord(state, applianceId)!.recommendations
    for (const rec of recs) await repo.setDecision(applianceId, rec.id, { kind: 'include' })

    const approved = await repo.approve(applianceId, '2026-10-05')
    const task = findRecord(approved, applianceId)!.tasks[0]
    await repo.recordCalendarResults(applianceId, [{ taskId: task.id, ok: true, eventId: 'evt' }])
    const done = await repo.addCompletion(applianceId, task.id, '2026-10-06')

    const record = findRecord(done, applianceId)!
    expect(record.tasks[0].calendarEventId).toBe('evt')
    expect(record.completions).toHaveLength(1)
  })

  it('keeps an unsaved change when storage reads work but writes fail (quota)', async () => {
    const backing = memoryStorage()
    const full = { getItem: backing.getItem, setItem: () => { throw new Error('QuotaExceededError') } }
    const repo = createDevicePlanRepository({ storage: full, newId: ids(), now: () => 'now' })
    const { applianceId, state } = await repo.addAppliance(input)
    const rec = findRecord(state, applianceId)!.recommendations[0]

    const next = await repo.setDecision(applianceId, rec.id, { kind: 'include' })
    expect(findRecord(next, applianceId)?.decisions[rec.id]).toEqual({ kind: 'include' })
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
    const { applianceId } = await repo.addAppliance(input)
    expect(findRecord(await repo.load(), applianceId)).toBeDefined()
  })

  it('works with no storage at all', async () => {
    const repo = createDevicePlanRepository({ storage: null, newId: ids() })
    await repo.addAppliance(input)
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
    const { applianceId: a } = await repo.addAppliance(input)
    const { applianceId: b } = await repo.addAppliance(input)
    const state = await repo.deleteAppliance(a)
    expect(state.records.map((r) => r.appliance.id)).toEqual([b])
    await expect(repo.deleteAppliance(a)).rejects.toThrow(/Unknown appliance/)
  })
})

describe('device photos', () => {
  it('keeps small photos and skips ones that would fill device storage', async () => {
    const { DEVICE_PHOTO_LIMIT } = await import('./plan-repository')
    const repo = createDevicePlanRepository({ storage: memoryStorage(), newId: ids() })
    const small = await repo.addAppliance({ ...input, photo: new Blob([new Uint8Array(10)], { type: 'image/jpeg' }) })
    const big = await repo.addAppliance({ ...input, photo: new Blob([new Uint8Array(DEVICE_PHOTO_LIMIT + 1)], { type: 'image/jpeg' }) })
    const state = await repo.load()
    expect(state.records.find((r) => r.appliance.id === small.applianceId)!.appliance.imageUrl).toMatch(/^data:image\/jpeg;base64,/)
    expect(state.records.find((r) => r.appliance.id === big.applianceId)!.appliance.imageUrl).toBeNull()
  })
})
