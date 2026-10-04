// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../page'
import { findRecord } from '../lib/plan-state'
import { getPlanState, resetPlanStoreForTests } from '../lib/plan-store'
import { ApplianceRecordView } from './[id]/appliance-record'
import { ApprovalSummary } from './[id]/approve/approval-summary'
import { PlanReview } from './[id]/plan/plan-review'
import { NewApplianceForm } from './new/new-appliance-form'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}))

type Calls = { url: string; body?: unknown }[]

function mockFetch(status: { configured: boolean; connected: boolean }, calls: Calls) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url === '/api/calendar/status') return Response.json(status)
      if (url === '/api/calendar/events') {
        const { drafts } = JSON.parse(init!.body as string) as { drafts: { taskId: string }[] }
        return Response.json({ results: drafts.map((d) => ({ taskId: d.taskId, ok: true, eventId: `evt-${d.taskId}` })) })
      }
      throw new Error(`unexpected fetch ${url}`)
    }),
  )
}

beforeEach(() => {
  resetPlanStoreForTests()
  push.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

function addDishwasher() {
  render(<NewApplianceForm newId={() => 'app-1'} />)
  fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
  fireEvent.change(screen.getByLabelText(/Model number/), { target: { value: 'SMS6ZCI49E' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' }))
}

function decide(name: string, choice: 'Include' | 'Skip') {
  const card = screen.getByRole('article', { name })
  fireEvent.click(within(card).getByRole('button', { name: choice }))
}

describe('manual dishwasher → approved plan', () => {
  it('requires a manufacturer', () => {
    render(<NewApplianceForm newId={() => 'app-1'} />)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/manufacturer/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('adds a dishwasher and proposes three general-guidance tasks', () => {
    addDishwasher()
    expect(push).toHaveBeenCalledWith('/appliances/app-1/plan')
    render(<PlanReview applianceId="app-1" />)

    expect(screen.getAllByRole('article')).toHaveLength(3)
    expect(screen.getAllByText('General guidance')).toHaveLength(3)
    expect(screen.queryByText(/manufacturer verified/i)).not.toBeInTheDocument()
  })

  it('blocks review until every task is decided and one is kept', () => {
    addDishwasher()
    render(<PlanReview applianceId="app-1" />)
    expect(screen.getByRole('button', { name: 'Review plan' })).toBeDisabled()

    decide('Clean the filter', 'Skip')
    decide('Run a cleaning cycle', 'Skip')
    decide('Check the spray arms', 'Skip')
    expect(screen.getByText('Include or customise at least one task.')).toBeInTheDocument()

    decide('Clean the filter', 'Include')
    expect(screen.getByRole('link', { name: 'Review plan' })).toHaveAttribute('href', '/appliances/app-1/approve')
  })

  it('writes nothing to the calendar before approval, then only approved tasks', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: true }, calls)
    addDishwasher()
    render(<PlanReview applianceId="app-1" />)
    decide('Clean the filter', 'Include')
    decide('Run a cleaning cycle', 'Include')
    decide('Check the spray arms', 'Skip')

    render(<ApprovalSummary applianceId="app-1" newId={(() => { let n = 0; return () => `task-${++n}` })()} />)
    await screen.findByText('Google Calendar connected.')
    expect(screen.getByText(/2 tasks will be added to your calendar, 1 skipped/)).toBeInTheDocument()
    expect(calls.map((c) => c.url)).toEqual(['/api/calendar/status'])
    expect(findRecord(getPlanState(), 'app-1')!.tasks).toEqual([])

    fireEvent.change(screen.getByLabelText('Start included tasks on'), { target: { value: '2026-10-05' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve maintenance plan' })))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=calendar'))
    const write = calls.find((c) => c.url === '/api/calendar/events')!.body as { drafts: { taskId: string; date: string; recurrence: string[] }[] }
    expect(write.drafts.map((d) => [d.taskId, d.date, d.recurrence])).toEqual([
      ['task-1', '2026-10-05', ['RRULE:FREQ=MONTHLY']],
      ['task-2', '2026-10-05', ['RRULE:FREQ=MONTHLY']],
    ])
    expect(findRecord(getPlanState(), 'app-1')!.tasks.map((t) => [t.status, t.calendarEventId])).toEqual([
      ['approved', 'evt-task-1'],
      ['approved', 'evt-task-2'],
      ['skipped', null],
    ])
  })

  it('saves the approved plan on the device when the calendar is not configured', async () => {
    const calls: Calls = []
    mockFetch({ configured: false, connected: false }, calls)
    addDishwasher()
    render(<PlanReview applianceId="app-1" />)
    decide('Clean the filter', 'Include')
    decide('Run a cleaning cycle', 'Skip')
    decide('Check the spray arms', 'Skip')

    render(<ApprovalSummary applianceId="app-1" />)
    await screen.findByText(/not set up on this server/)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve maintenance plan' })))

    expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=saved')
    expect(calls.some((c) => c.url === '/api/calendar/events')).toBe(false)
  })

  it('shows the record with the next due date and records completions', async () => {
    mockFetch({ configured: false, connected: false }, [])
    addDishwasher()
    render(<PlanReview applianceId="app-1" />)
    decide('Clean the filter', 'Include')
    decide('Run a cleaning cycle', 'Skip')
    decide('Check the spray arms', 'Skip')
    render(<ApprovalSummary applianceId="app-1" />)
    await screen.findByText(/not set up on this server/)
    fireEvent.change(screen.getByLabelText('Start included tasks on'), { target: { value: '2026-10-05' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve maintenance plan' })))
    document.body.innerHTML = ''

    render(<ApplianceRecordView applianceId="app-1" />)
    expect(screen.getByRole('heading', { name: 'Clean the filter' })).toBeInTheDocument()
    expect(screen.getByText('5 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('Not added yet')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Mark done today' }))
    expect(findRecord(getPlanState(), 'app-1')!.completions).toHaveLength(1)
  })

  it('lists the dishwasher on Home', () => {
    addDishwasher()
    render(<Home />)
    expect(screen.getByRole('link', { name: /Bosch SMS6ZCI49E dishwasher/ })).toHaveAttribute('href', '/appliances/app-1/plan')
    expect(screen.queryByText('No appliances yet.')).not.toBeInTheDocument()
  })
})
