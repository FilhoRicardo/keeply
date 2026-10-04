// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../page'
import type { PlanRepository } from '../lib/plan-repository'
import { findRecord } from '../lib/plan-state'
import { renderWithPlan, testRepository } from '../test-utils'
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

let repo: PlanRepository
beforeEach(() => {
  repo = testRepository()
  push.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

const record = async () => findRecord(await repo.load(), 'app-1')!

async function addDishwasher() {
  renderWithPlan(<NewApplianceForm />, repo)
  fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
  fireEvent.change(screen.getByLabelText(/Model number/), { target: { value: 'SMS6ZCI49E' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' })))
  cleanup()
}

async function decide(name: string, choice: 'Include' | 'Skip') {
  const card = await screen.findByRole('article', { name })
  await act(async () => fireEvent.click(within(card).getByRole('button', { name: choice })))
}

async function decideAll(choices: Record<string, 'Include' | 'Skip'>) {
  renderWithPlan(<PlanReview applianceId="app-1" />, repo)
  for (const [name, choice] of Object.entries(choices)) await decide(name, choice)
  cleanup()
}

async function approveWith(startDate = '2026-10-05') {
  renderWithPlan(<ApprovalSummary applianceId="app-1" />, repo)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Approve maintenance plan' })).toBeEnabled())
  fireEvent.change(screen.getByLabelText('Start included tasks on'), { target: { value: startDate } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve maintenance plan' })))
  cleanup()
}

describe('manual dishwasher → approved plan', () => {
  it('requires a manufacturer', () => {
    renderWithPlan(<NewApplianceForm />, repo)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/manufacturer/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('adds a dishwasher and proposes three general-guidance tasks', async () => {
    await addDishwasher()
    expect(push).toHaveBeenCalledWith('/appliances/app-1/plan')
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    expect(await screen.findAllByRole('article')).toHaveLength(3)
    expect(screen.getAllByText('General guidance')).toHaveLength(3)
    expect(screen.queryByText(/manufacturer verified/i)).not.toBeInTheDocument()
  })

  it('blocks review until every task is decided and one is kept', async () => {
    await addDishwasher()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)
    expect(await screen.findByRole('button', { name: 'Review plan' })).toBeDisabled()

    await decide('Clean the filter', 'Skip')
    await decide('Run a cleaning cycle', 'Skip')
    await decide('Check the spray arms', 'Skip')
    expect(screen.getByText('Include or customise at least one task.')).toBeInTheDocument()

    await decide('Clean the filter', 'Include')
    expect(screen.getByRole('link', { name: 'Review plan' })).toHaveAttribute('href', '/appliances/app-1/approve')
  })

  it('writes nothing to the calendar before approval, then only approved tasks', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: true }, calls)
    await addDishwasher()
    await decideAll({ 'Clean the filter': 'Include', 'Run a cleaning cycle': 'Include', 'Check the spray arms': 'Skip' })

    renderWithPlan(<ApprovalSummary applianceId="app-1" />, repo)
    await screen.findByText('Google Calendar connected.')
    expect(screen.getByText(/2 tasks will be added to your calendar, 1 skipped/)).toBeInTheDocument()
    expect(calls.map((c) => c.url)).toEqual(['/api/calendar/status'])
    expect((await record()).tasks).toEqual([])
    cleanup()

    await approveWith('2026-10-05')

    await waitFor(() => expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=calendar'))
    const write = calls.find((c) => c.url === '/api/calendar/events')!.body as {
      drafts: { taskId: string; date: string; recurrence: string[] }[]
    }
    expect(write.drafts.map((d) => [d.taskId, d.date, d.recurrence])).toEqual([
      ['task-1', '2026-10-05', ['RRULE:FREQ=MONTHLY']],
      ['task-2', '2026-10-05', ['RRULE:FREQ=MONTHLY']],
    ])
    expect((await record()).tasks.map((t) => [t.status, t.calendarEventId])).toEqual([
      ['approved', 'evt-task-1'],
      ['approved', 'evt-task-2'],
      ['skipped', null],
    ])
  })

  it('saves the approved plan on the device when the calendar is not configured', async () => {
    const calls: Calls = []
    mockFetch({ configured: false, connected: false }, calls)
    await addDishwasher()
    await decideAll({ 'Clean the filter': 'Include', 'Run a cleaning cycle': 'Skip', 'Check the spray arms': 'Skip' })
    await approveWith()

    expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=saved')
    expect(calls.some((c) => c.url === '/api/calendar/events')).toBe(false)
  })

  it('shows the record with the next due date and records completions', async () => {
    mockFetch({ configured: false, connected: false }, [])
    await addDishwasher()
    await decideAll({ 'Clean the filter': 'Include', 'Run a cleaning cycle': 'Skip', 'Check the spray arms': 'Skip' })
    await approveWith('2026-10-05')

    renderWithPlan(<ApplianceRecordView applianceId="app-1" />, repo)
    expect(await screen.findByRole('heading', { name: 'Clean the filter' })).toBeInTheDocument()
    expect(screen.getByText('5 Oct 2026')).toBeInTheDocument()
    expect(screen.getByText('Not added yet')).toBeInTheDocument()
    const sources = screen.getByRole('list', { name: 'Sources' })
    expect(within(sources).getByText('Keeply general dishwasher maintenance guidance')).toBeInTheDocument()
    expect(within(sources).getByText(/could not find model-specific guidance/)).toBeInTheDocument()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mark done today' })))
    expect((await record()).completions).toHaveLength(1)
  })

  it('moves the calendar event of a completion-based task when it is done', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: true }, calls)
    await addDishwasher()
    const rec = (await record()).recommendations[0]
    await repo.setDecision('app-1', rec.id, {
      kind: 'customise',
      interval: { count: 30, unit: 'day' },
      startDate: '2026-06-01',
      schedulingMode: 'completion_based',
    })
    for (const other of (await record()).recommendations.slice(1)) await repo.setDecision('app-1', other.id, { kind: 'skip' })
    await repo.approve('app-1', '2026-06-01')
    await repo.recordCalendarResults('app-1', [{ taskId: 'task-1', ok: true, eventId: 'evt-task-1' }])

    renderWithPlan(<ApplianceRecordView applianceId="app-1" />, repo)
    await screen.findByRole('heading', { name: 'Clean the filter' })
    await waitFor(() => expect(calls.map((c) => c.url)).toContain('/api/calendar/status'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Mark done today' })))

    const write = await waitFor(() => {
      const call = calls.find((c) => c.url === '/api/calendar/events')
      expect(call).toBeDefined()
      return call!.body as { drafts: { taskId: string; date: string; recurrence: string[] }[] }
    })
    const done = (await record()).completions[0].completedOn
    expect(write.drafts).toHaveLength(1)
    expect(write.drafts[0]).toMatchObject({ taskId: 'task-1', recurrence: [] })
    expect(write.drafts[0].date > done).toBe(true)
    expect(await screen.findByText(/Reminder moved to/)).toBeInTheDocument()
  })

  it('lists the dishwasher on Home', async () => {
    await addDishwasher()
    renderWithPlan(<Home />, repo)
    expect(await screen.findByRole('link', { name: /Bosch SMS6ZCI49E dishwasher/ })).toHaveAttribute(
      'href',
      '/appliances/app-1/plan',
    )
    expect(screen.queryByText('No appliances yet.')).not.toBeInTheDocument()
  })
})

describe('validation funnel', () => {
  it('tracks the Phase 1 funnel with ids and counts only', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: true }, calls)
    const events: { name: string }[] = []
    const sink = (e: { name: string }) => void events.push(e)

    renderWithPlan(<NewApplianceForm />, repo, sink)
    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' })))
    cleanup()

    renderWithPlan(<PlanReview applianceId="app-1" />, repo, sink)
    await decide('Clean the filter', 'Include')
    await decide('Run a cleaning cycle', 'Skip')
    await decide('Check the spray arms', 'Skip')
    cleanup()

    renderWithPlan(<ApprovalSummary applianceId="app-1" />, repo, sink)
    await screen.findByText('Google Calendar connected.')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Approve maintenance plan' })))
    await waitFor(() => expect(push).toHaveBeenCalled())

    expect(events.map((e) => e.name)).toEqual([
      'appliance_added',
      'recommendations_generated',
      'recommendation_decided',
      'recommendation_decided',
      'recommendation_decided',
      'plan_approved',
      'calendar_tasks_created',
    ])
    expect(JSON.stringify(events)).not.toMatch(/Bosch/)
    expect(events.find((e) => e.name === 'plan_approved')).toMatchObject({ approved: 1, skipped: 2 })
  })
})

describe('storage failures', () => {
  it('shows a banner and keeps the user on the form when saving fails', async () => {
    const failing: PlanRepository = {
      ...testRepository(),
      addAppliance: () => Promise.reject(new Error('network down')),
    }
    renderWithPlan(<NewApplianceForm />, failing)
    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' })))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach your plan\. network down/)
    expect(push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Continue to maintenance plan' })).toBeEnabled()
  })

  it('offers a retry when loading fails', async () => {
    let calls = 0
    const flaky: PlanRepository = {
      ...testRepository(),
      load: () => (++calls === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve({ version: 1, records: [] })),
    }
    renderWithPlan(<Home />, flaky)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No appliances yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('calendar_connected', () => {
  it('is tracked once when Google returns and the query is removed', async () => {
    window.history.replaceState(null, '', '/appliances/app-1/approve?calendar=connected')
    const events: { name: string }[] = []
    renderWithPlan(<Home />, repo, (e) => void events.push(e))
    await screen.findByText('No appliances yet.')
    expect(events.map((e) => e.name)).toEqual(['calendar_connected'])
    expect(window.location.search).toBe('')
  })
})

describe('deleting a dishwasher', () => {
  it('asks first, mentions calendar events, then removes it and goes home', async () => {
    mockFetch({ configured: true, connected: true }, [])
    await addDishwasher()
    await decideAll({ 'Clean the filter': 'Include', 'Run a cleaning cycle': 'Skip', 'Check the spray arms': 'Skip' })
    await approveWith()

    renderWithPlan(<ApplianceRecordView applianceId="app-1" />, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this dishwasher' }))
    expect(screen.getByText(/Events already in Google Calendar stay there/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await repo.load()).records).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Delete this dishwasher' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })))
    expect(push).toHaveBeenLastCalledWith('/')
    expect((await repo.load()).records).toEqual([])
  })
})
