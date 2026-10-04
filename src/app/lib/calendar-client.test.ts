import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CatalogEntry } from '@/domain/guidance'
import { writeApprovedTasks } from './calendar-client'
import { addAppliance, approve, EMPTY_STATE, findRecord, setDecision } from './plan-state'

afterEach(() => vi.unstubAllGlobals())

// Fixture catalog with 25 tasks for one model, to exceed the 20-events-per-request limit.
const catalog: CatalogEntry[] = Array.from({ length: 25 }, (_, i) => ({
  manufacturer: 'Fixturebrand',
  modelScope: 'FB-1',
  sourceType: 'manufacturer_manual',
  title: 'Fixture manual',
  reference: 'https://example.com/m.pdf',
  sourceLocation: null,
  taskName: `Task ${i + 1}`,
  description: 'Fixture.',
  interval: { count: 1, unit: 'month' },
}))

describe('writeApprovedTasks', () => {
  it('splits large plans into requests of at most 20 events and merges the results', async () => {
    let state = addAppliance(EMPTY_STATE, { manufacturer: 'Fixturebrand', model: 'FB-1', serialNumber: '' }, 'a', 'now', null, catalog)
    for (const rec of findRecord(state, 'a')!.recommendations) state = setDecision(state, 'a', rec.id, { kind: 'include' })
    let n = 0
    state = approve(state, 'a', '2026-10-05', () => `t${++n}`, 'now')

    const sizes: number[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const { drafts } = JSON.parse(init.body as string) as { drafts: { taskId: string }[] }
      sizes.push(drafts.length)
      return Response.json({ results: drafts.map((d) => ({ taskId: d.taskId, ok: true, eventId: `e-${d.taskId}` })) })
    })

    const outcome = await writeApprovedTasks(findRecord(state, 'a')!)
    expect(sizes).toEqual([20, 5])
    expect(outcome.kind === 'written' && outcome.results.length).toBe(25)
  })
})
