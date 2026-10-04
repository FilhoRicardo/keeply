import { afterEach, describe, expect, it, vi } from 'vitest'
import { record, task } from '@/domain/test-fixtures'
import { writeApprovedTasks } from './calendar-client'

afterEach(() => vi.unstubAllGlobals())

describe('writeApprovedTasks', () => {
  it('splits large plans into requests of at most 20 events and merges the results', async () => {
    const tasks = Array.from({ length: 25 }, (_, i) => task({ id: `t${i + 1}`, status: 'accepted' }))
    const approved = record({ tasks, approvedAt: 'now', startDate: '2026-10-05' })
    const sizes: number[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      const { drafts } = JSON.parse(init.body as string) as { drafts: { taskId: string }[] }
      sizes.push(drafts.length)
      return Response.json({ results: drafts.map((d) => ({ taskId: d.taskId, ok: true, eventId: `e-${d.taskId}` })) })
    })

    const outcome = await writeApprovedTasks(approved)
    expect(sizes).toEqual([20, 5])
    expect(outcome.kind === 'written' && outcome.results.length).toBe(25)
  })

  it('sends only ids with a Supabase session, and only tasks still missing from the calendar', async () => {
    const approved = record({
      tasks: [task({ id: 'a', status: 'accepted', calendarEventId: 'evt' }), task({ id: 'b', status: 'accepted' }), task({ id: 'c', status: 'rejected' })],
      approvedAt: 'now',
      startDate: '2026-10-05',
    })
    const bodies: unknown[] = []
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(init.body as string))
      return Response.json({ results: [] })
    })
    await writeApprovedTasks(approved, 'token')
    expect(bodies).toEqual([{ applianceId: 'app-1', taskIds: ['b'] }])
  })
})
