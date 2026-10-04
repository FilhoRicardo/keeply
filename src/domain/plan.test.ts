import { describe, expect, it } from 'vitest'
import { approvalBlockers, approvePlan, calendarBound, canApprove, decideTask, pendingCalendarTasks } from './plan'
import { frozen, record, task } from './test-fixtures'

const decided = (filter: 'accepted' | 'rejected', rinse: 'accepted' | 'rejected') =>
  record({ tasks: [task({ status: filter }), task({ id: 'task-rinse', status: rinse })] })

describe('approval rules', () => {
  it('blocks approval until every task is accepted or rejected', () => {
    expect(approvalBlockers([{ status: 'accepted' }, { status: 'proposed' }])).toEqual(['undecided'])
  })

  it('blocks approval when every task is rejected', () => {
    expect(approvalBlockers([{ status: 'rejected' }, { status: 'rejected' }])).toEqual(['nothing_accepted'])
  })

  it('allows approval when all are decided and one is accepted', () => {
    expect(canApprove(decided('accepted', 'rejected').tasks)).toBe(true)
  })
})

describe('decideTask', () => {
  it('records the answer without touching the proposal', () => {
    const plan = frozen(record())
    const next = decideTask(plan, 'task-filter', 'accepted')
    expect(next.tasks[0]).toEqual({ ...plan.tasks[0], status: 'accepted' })
    expect(next.tasks[1]).toBe(plan.tasks[1])
  })

  it('takes an answer back with null', () => {
    expect(decideTask(decided('accepted', 'rejected'), 'task-filter', null).tasks[0].status).toBe('proposed')
  })

  it('refuses after Approval and for unknown tasks', () => {
    const approved = approvePlan(decided('accepted', 'rejected'), '2026-10-05', 'now')
    expect(() => decideTask(approved, 'task-filter', 'rejected')).toThrow(/already approved/)
    expect(() => decideTask(record(), 'nope', 'accepted')).toThrow(/Unknown task/)
  })
})

describe('approvePlan', () => {
  it('stamps the approval and start date', () => {
    expect(approvePlan(decided('accepted', 'rejected'), '2026-10-05', '2026-10-04T10:00:00Z')).toMatchObject({
      approvedAt: '2026-10-04T10:00:00Z',
      startDate: '2026-10-05',
    })
  })

  it('refuses an undecided plan, a bad date or a second approval', () => {
    expect(() => approvePlan(record(), '2026-10-05', 'now')).toThrow(/undecided/)
    expect(() => approvePlan(decided('accepted', 'rejected'), '2026-02-30', 'now')).toThrow(/LocalDate/)
    const approved = approvePlan(decided('accepted', 'rejected'), '2026-10-05', 'now')
    expect(() => approvePlan(approved, '2026-10-05', 'now')).toThrow(/already approved/)
  })
})

describe('calendarBound', () => {
  it('is empty before Approval, even for accepted tasks', () => {
    expect(calendarBound(decided('accepted', 'accepted'))).toEqual([])
  })

  it('keeps only accepted tasks after Approval', () => {
    const approved = approvePlan(decided('accepted', 'rejected'), '2026-10-05', 'now')
    expect(calendarBound(approved).map((t) => t.id)).toEqual(['task-filter'])
  })

  it('lists accepted tasks still missing a calendar event', () => {
    const approved = approvePlan(decided('accepted', 'accepted'), '2026-10-05', 'now')
    const oneWritten = { ...approved, tasks: [{ ...approved.tasks[0], calendarEventId: 'evt' }, approved.tasks[1]] }
    expect(pendingCalendarTasks(oneWritten).map((t) => t.id)).toEqual(['task-rinse'])
  })
})
