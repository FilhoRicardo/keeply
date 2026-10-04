import { describe, expect, it } from 'vitest'
import { record, task } from '@/domain/test-fixtures'
import { summary } from './appliance-list'

describe('appliance summary', () => {
  it('asks for a review before Approval', () => {
    expect(summary(record())).toBe('Plan waiting for your review')
  })

  it('counts accepted tasks and those still missing from the calendar', () => {
    const approved = record({
      approvedAt: 'now',
      startDate: '2026-10-05',
      tasks: [task({ status: 'accepted', calendarEventId: 'evt' }), task({ id: 't2', status: 'accepted' }), task({ id: 't3', status: 'rejected' })],
    })
    expect(summary(approved)).toBe('2 tasks approved · 1 not in Google Calendar yet')
    expect(summary({ ...approved, tasks: [task({ status: 'accepted', calendarEventId: 'evt' })] })).toBe('1 task in Google Calendar')
  })
})
