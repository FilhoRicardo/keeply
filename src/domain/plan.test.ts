import { describe, expect, it } from 'vitest'
import { approvalBlockers, approvePlan, calendarBound, canApprove, rescheduleTask, validateCustomisation, type Decisions } from './plan'
import { frozen, recommendation, sequentialIds } from './test-fixtures'

const filter = recommendation()
const rinse = recommendation({ id: 'rec-rinse', taskName: 'Top up rinse aid', recommendedInterval: { count: 1, unit: 'month' } })
const recs = [filter, rinse]

describe('approval rules', () => {
  it('blocks approval until every Recommendation has a decision', () => {
    expect(approvalBlockers(recs, { [filter.id]: { kind: 'include' } })).toEqual(['undecided'])
  })

  it('blocks approval when everything is skipped', () => {
    const decisions: Decisions = { [filter.id]: { kind: 'skip' }, [rinse.id]: { kind: 'skip' } }
    expect(approvalBlockers(recs, decisions)).toEqual(['nothing_included'])
  })

  it('blocks approval on an invalid customisation', () => {
    const decisions: Decisions = {
      [filter.id]: { kind: 'customise', interval: { count: 0, unit: 'day' }, startDate: '2026-10-05', schedulingMode: 'fixed_calendar' },
      [rinse.id]: { kind: 'skip' },
    }
    expect(approvalBlockers(recs, decisions)).toEqual(['invalid_customisation'])
  })

  it('allows approval when all are decided and one is kept', () => {
    expect(canApprove(recs, { [filter.id]: { kind: 'include' }, [rinse.id]: { kind: 'skip' } })).toBe(true)
  })

  it('refuses to approve a blocked plan', () => {
    expect(() =>
      approvePlan({ recommendations: recs, decisions: {}, defaultStartDate: '2026-10-05', newId: sequentialIds() }),
    ).toThrow(/undecided/)
  })
})

describe('validateCustomisation', () => {
  it.each([
    [{ count: 1.5, unit: 'month' as const }, '2026-10-05'],
    [{ count: 1000, unit: 'day' as const }, '2026-10-05'],
    [{ count: 1, unit: 'month' as const }, 'tomorrow'],
  ])('rejects %o starting %s', (interval, startDate) => {
    expect(validateCustomisation({ interval, startDate, schedulingMode: 'fixed_calendar' })).not.toBeNull()
  })
})

describe('approvePlan', () => {
  it('keeps the manufacturer recommendation and stores the user schedule on the Task', () => {
    const original = frozen(recommendation())
    const [task] = approvePlan({
      recommendations: [original],
      decisions: {
        [original.id]: {
          kind: 'customise',
          interval: { count: 30, unit: 'day' },
          startDate: '2026-10-10',
          schedulingMode: 'completion_based',
        },
      },
      defaultStartDate: '2026-10-05',
      newId: sequentialIds(),
    })

    expect(original.recommendedInterval).toEqual({ count: 14, unit: 'day' })
    expect(task).toEqual({
      id: 'task-1',
      applianceId: 'app-1',
      recommendationId: 'rec-filter',
      status: 'approved',
      userInterval: { count: 30, unit: 'day' },
      startDate: '2026-10-10',
      schedulingMode: 'completion_based',
      calendarEventId: null,
    })
  })

  it('includes as recommended on a fixed calendar from the default start date', () => {
    const [task] = approvePlan({
      recommendations: [filter],
      decisions: { [filter.id]: { kind: 'include' } },
      defaultStartDate: '2026-10-05',
      newId: sequentialIds(),
    })
    expect(task).toMatchObject({ status: 'approved', userInterval: { count: 14, unit: 'day' }, startDate: '2026-10-05', schedulingMode: 'fixed_calendar' })
    expect(task.userInterval).not.toBe(filter.recommendedInterval)
  })

  it('records skipped Recommendations as skipped Tasks that never reach a calendar', () => {
    const tasks = approvePlan({
      recommendations: recs,
      decisions: { [filter.id]: { kind: 'include' }, [rinse.id]: { kind: 'skip' } },
      defaultStartDate: '2026-10-05',
      newId: sequentialIds(),
    })
    expect(tasks.map((t) => t.status)).toEqual(['approved', 'skipped'])
    expect(calendarBound(tasks).map((t) => t.recommendationId)).toEqual(['rec-filter'])
  })
})

describe('rescheduleTask', () => {
  const [approved, skipped] = approvePlan({
    recommendations: recs,
    decisions: { [filter.id]: { kind: 'include' }, [rinse.id]: { kind: 'skip' } },
    defaultStartDate: '2026-10-05',
    newId: sequentialIds(),
  })
  const change = { interval: { count: 6, unit: 'week' as const }, startDate: '2026-11-01', schedulingMode: 'completion_based' as const }

  it('changes only the owner’s schedule, keeping identity and calendar link', () => {
    const linked = { ...approved, calendarEventId: 'evt-1' }
    expect(rescheduleTask(linked, change)).toEqual({ ...linked, userInterval: { count: 6, unit: 'week' }, startDate: '2026-11-01', schedulingMode: 'completion_based' })
    expect(filter.recommendedInterval).toEqual({ count: 14, unit: 'day' })
  })

  it('refuses skipped tasks and invalid schedules', () => {
    expect(() => rescheduleTask(skipped, change)).toThrow(/approved/)
    expect(() => rescheduleTask(approved, { ...change, interval: { count: 0, unit: 'day' } })).toThrow()
  })
})
