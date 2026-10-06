// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '../page'
import type { Account, SignInResult } from '../lib/account'
import type { PlanRepository } from '../lib/plan-repository'
import { findRecord } from '../lib/plan-state'
import type { FunnelEvent } from '../lib/track'
import { renderWithPlan, testRepository } from '../test-utils'
import { ApplianceRecordView } from './[id]/appliance-record'
import { PlanReview } from './[id]/plan/plan-review'
import { NewApplianceForm } from './new/new-appliance-form'

const push = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}))

type Calls = { url: string; body?: unknown }[]

function mockFetch(status: { configured: boolean; connected: boolean }, calls: Calls, opts: { failWrites?: number; plan?: 'disabled' | 'general' | 'verified' } = {}) {
  let failWrites = opts.failWrites ?? 0
  const plan = opts.plan ?? 'general'
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
      if (url === '/api/calendar/status') return Response.json(status)
      if (url === '/api/calendar/disconnect') return Response.json({ connected: false })
      if (url === '/api/plan') {
        // Default for the flow test: the live search is disabled, the proposer falls back to
        // general guidance. Tests that exercise the UI banner with a real fallback override
        // `plan: 'general'` or `plan: 'verified'`.
        if (plan === 'disabled') return new Response(null, { status: 404 })
        if (plan === 'general') {
          return Response.json({
            proposals: [
              {
                name: 'Clean the filter',
                instructions: 'Twist out the filter at the bottom of the tub, rinse it under warm water.',
                interval: { count: 1, unit: 'month' },
                evidenceLevel: 'general_guidance',
                source: { type: 'general_guidance', title: 'Keeply general dishwasher maintenance guidance', url: null, location: null, quote: null },
              },
              {
                name: 'Run a cleaning cycle',
                instructions: 'Run the hottest programme empty with a dishwasher cleaner.',
                interval: { count: 1, unit: 'month' },
                evidenceLevel: 'general_guidance',
                source: { type: 'general_guidance', title: 'Keeply general dishwasher maintenance guidance', url: null, location: null, quote: null },
              },
              {
                name: 'Check the spray arms',
                instructions: 'Remove the spray arms, check they spin freely.',
                interval: { count: 3, unit: 'month' },
                evidenceLevel: 'general_guidance',
                source: { type: 'general_guidance', title: 'Keeply general dishwasher maintenance guidance', url: null, location: null, quote: null },
              },
            ],
            fallback: 'general',
            searchOutcome: 'no_results',
            searchReason: 'no_key',
          })
        }
        // verified: covered by the manufacturer-guidance tests below; this path is never
        // reached by the existing flow tests.
        return new Response(null, { status: 500 })
      }
      if (url === '/api/calendar/events') {
        if (failWrites-- > 0) return new Response(null, { status: 502 })
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
  search = new URLSearchParams()
})
afterEach(() => vi.unstubAllGlobals())

const record = async () => findRecord(await repo.load(), 'app-1')!
// Lets the provider's async effects (plan load, account lookup) commit inside act().
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

async function addDishwasher(sink?: (e: FunnelEvent) => void) {
  renderWithPlan(<NewApplianceForm />, repo, sink)
  fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
  fireEvent.change(screen.getByLabelText(/Model number/), { target: { value: 'SMS6ZCI49E' } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' })))
  cleanup()
}

async function decide(name: string, choice: 'Accept' | 'Reject') {
  const card = await screen.findByRole('article', { name })
  await act(async () => fireEvent.click(within(card).getByRole('button', { name: choice })))
}

const approveButton = () => screen.getByRole('button', { name: /^Approve/ })

// Decides every task on the plan screen, then approves from the same screen.
async function decideAndApprove(choices: Record<string, 'Accept' | 'Reject'>, startDate = '2026-10-05', sink?: (e: FunnelEvent) => void) {
  renderWithPlan(<PlanReview applianceId="app-1" />, repo, sink)
  for (const [name, choice] of Object.entries(choices)) await decide(name, choice)
  await waitFor(() => expect(approveButton()).toBeEnabled())
  fireEvent.change(screen.getByLabelText('First reminder on'), { target: { value: startDate } })
  await act(async () => fireEvent.click(approveButton()))
  await waitFor(() => expect(push).toHaveBeenCalled())
  cleanup()
}

const ONE_ACCEPTED = { 'Clean the filter': 'Accept', 'Run a cleaning cycle': 'Reject', 'Check the spray arms': 'Reject' } as const

describe('manual dishwasher → approved plan', () => {
  it('requires a manufacturer', () => {
    renderWithPlan(<NewApplianceForm />, repo)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/manufacturer/i)
    expect(push).not.toHaveBeenCalled()
  })

  it('adds a dishwasher and proposes three general-guidance tasks', async () => {
    mockFetch({ configured: false, connected: false }, [])
    await addDishwasher()
    expect(push).toHaveBeenCalledWith('/appliances/app-1/plan')
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    expect(await screen.findAllByRole('article')).toHaveLength(3)
    // KEE-43: the plan screen also shows a fallback banner with the "General guidance" eyebrow
    // when every task is general-guidance; we count the three per-task chips (not the banner).
    const list = screen.getByRole('list') as HTMLElement
    const cards = list.querySelectorAll('.plan-card')
    expect(cards).toHaveLength(3)
    const chips = list.querySelectorAll('.plan-card .evidence-badge')
    expect(chips).toHaveLength(3)
    expect(list.querySelectorAll('.evidence--manufacturer_verified')).toHaveLength(0)
    expect(screen.queryByText(/manufacturer verified/i)).not.toBeInTheDocument()
  })

  it('blocks approval until every task is decided and one is accepted', async () => {
    mockFetch({ configured: false, connected: false }, [])
    await addDishwasher()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)
    await screen.findByText('Google Calendar is not set up on this server yet. Your approved plan will be saved on this device.')
    expect(approveButton()).toBeDisabled()
    expect(screen.getByText('Accept or reject every task.')).toBeInTheDocument()

    await decide('Clean the filter', 'Reject')
    await decide('Run a cleaning cycle', 'Reject')
    await decide('Check the spray arms', 'Reject')
    expect(screen.getByText('Accept at least one task.')).toBeInTheDocument()
    expect(approveButton()).toBeDisabled()

    await decide('Clean the filter', 'Accept')
    expect(approveButton()).toBeEnabled()
  })

  it('takes an answer back when the pressed button is pressed again', async () => {
    mockFetch({ configured: false, connected: false }, [])
    await addDishwasher()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)
    await decide('Clean the filter', 'Accept')
    await decide('Clean the filter', 'Accept')
    expect((await record()).tasks[0].status).toBe('proposed')
  })

  it('writes nothing to the calendar before Approval, then only accepted tasks', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: true }, calls)
    await addDishwasher()

    renderWithPlan(<PlanReview applianceId="app-1" />, repo)
    await decide('Clean the filter', 'Accept')
    await decide('Run a cleaning cycle', 'Accept')
    await decide('Check the spray arms', 'Reject')
    await screen.findByText('Google Calendar connected.')
    expect(screen.getByRole('button', { name: 'Approve and add 2 tasks to Google Calendar' })).toBeEnabled()
    // KEE-43: the live proposer is the default; the first call is /api/plan, then calendar status.
    expect(calls.map((c) => c.url)).toEqual(['/api/plan', '/api/calendar/status'])
    expect((await record()).approvedAt).toBeNull()

    fireEvent.change(screen.getByLabelText('First reminder on'), { target: { value: '2026-10-05' } })
    await act(async () => fireEvent.click(approveButton()))

    await waitFor(() => expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=calendar'))
    const write = calls.find((c) => c.url === '/api/calendar/events')!.body as {
      drafts: { taskId: string; date: string; recurrence: string[] }[]
    }
    expect(write.drafts.map((d) => [d.taskId, d.date, d.recurrence])).toEqual([
      ['task-1', '2026-10-05', ['RRULE:FREQ=MONTHLY']],
      ['task-2', '2026-10-05', ['RRULE:FREQ=MONTHLY']],
    ])
    expect((await record()).tasks.map((t) => [t.status, t.calendarEventId])).toEqual([
      ['accepted', 'evt-task-1'],
      ['accepted', 'evt-task-2'],
      ['rejected', null],
    ])
  })

  it('saves the approved plan on the device when the calendar is not configured', async () => {
    const calls: Calls = []
    mockFetch({ configured: false, connected: false }, calls)
    await addDishwasher()
    await decideAndApprove(ONE_ACCEPTED)

    expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=saved')
    expect(calls.some((c) => c.url === '/api/calendar/events')).toBe(false)
  })

  it('shows the approved dishwasher read-only and points to Google Calendar', async () => {
    mockFetch({ configured: true, connected: true }, [])
    await addDishwasher()
    await decideAndApprove(ONE_ACCEPTED)
    search = new URLSearchParams('approved=calendar')

    renderWithPlan(<ApplianceRecordView applianceId="app-1" />, repo)
    expect(await screen.findByText('Plan approved. Your tasks are in Google Calendar.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Clean the filter' })).toBeInTheDocument()
    expect(screen.getByText('Added')).toBeInTheDocument()
    expect(screen.getByText(/Run a cleaning cycle, Check the spray arms/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open Google Calendar' })).toHaveAttribute('href', 'https://calendar.google.com')
    expect(screen.queryByRole('button', { name: /Accept|Reject/ })).not.toBeInTheDocument()
  })

  it('lists the dishwasher on Home', async () => {
    mockFetch({ configured: true, connected: true }, [])
    await addDishwasher()
    await decideAndApprove(ONE_ACCEPTED)
    renderWithPlan(<Home />, repo)
    expect(await screen.findByRole('link', { name: /Bosch SMS6ZCI49E/ })).toHaveTextContent('1 task in Google Calendar')
  })
})

describe('when the calendar write fails', () => {
  it('keeps the plan approved and offers to add the missing tasks later', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: true }, calls, { failWrites: 1 })
    await addDishwasher()
    await decideAndApprove(ONE_ACCEPTED)
    expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=failed')
    expect((await record()).approvedAt).not.toBeNull()

    renderWithPlan(<ApplianceRecordView applianceId="app-1" />, repo)
    const add = await screen.findByRole('button', { name: 'Add 1 task to Google Calendar' })
    await act(async () => fireEvent.click(add))
    expect(await screen.findByText('Added to Google Calendar.')).toBeInTheDocument()
    expect((await record()).tasks[0].calendarEventId).toBe('evt-task-1')
  })
})

describe('calendar permission denied', () => {
  it('explains that nothing was added and still allows approval', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: false }, calls)
    await addDishwasher()
    search = new URLSearchParams('calendar=denied')

    renderWithPlan(<PlanReview applianceId="app-1" />, repo)
    expect(await screen.findByText(/Google Calendar was not connected, so nothing was added/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connect Google Calendar' })).toHaveAttribute(
      'href',
      '/auth/google/start?returnTo=%2Fappliances%2Fapp-1%2Fplan',
    )
    cleanup()
    await decideAndApprove(ONE_ACCEPTED)
    expect(push).toHaveBeenCalledWith('/appliances/app-1?approved=saved')
    expect(calls.some((c) => c.url === '/api/calendar/events')).toBe(false)
  })
})

describe('usage tracking', () => {
  it('counts the flow without names, models or dates', async () => {
    mockFetch({ configured: true, connected: true }, [])
    const events: FunnelEvent[] = []
    const sink = (e: FunnelEvent) => void events.push(e)
    await addDishwasher(sink)
    await decideAndApprove(ONE_ACCEPTED, '2026-10-05', sink)

    expect(events).toEqual([
      { name: 'appliance_added', scanned: false },
      { name: 'plan_proposed', tasks: 3, verified: 0 },
      { name: 'plan_approved', accepted: 1, rejected: 2 },
      { name: 'calendar_tasks_created', count: 1 },
    ])
    expect(JSON.stringify(events)).not.toMatch(/Bosch|SMS6|2026/)
  })

  it('tracks calendar_connected once when Google returns and tidies the URL', async () => {
    window.history.replaceState(null, '', '/appliances/app-1/plan?calendar=connected')
    const events: FunnelEvent[] = []
    renderWithPlan(<Home />, repo, (e) => void events.push(e))
    await screen.findByText('No appliances yet.')
    expect(events).toEqual([{ name: 'calendar_connected' }])
    expect(window.location.search).toBe('')
  })
})

describe('storage failures', () => {
  it('shows a banner and keeps the user on the form when saving fails', async () => {
    const failing: PlanRepository = { ...testRepository(), addAppliance: () => Promise.reject(new Error('network down')) }
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
      load: () => (++calls === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve({ version: 2, records: [] })),
    }
    renderWithPlan(<Home />, flaky)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('No appliances yet.')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('overlapping saves', () => {
  it('applies decisions in order even when an earlier save is slower', async () => {
    mockFetch({ configured: false, connected: false }, [])
    await addDishwasher()
    const base = repo
    let first = true
    const slow: PlanRepository = {
      ...base,
      // Like a network store: the write lands at once, the snapshot comes back late.
      async decide(a, t, d) {
        const snapshot = await base.decide(a, t, d)
        if (first) {
          first = false
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        return snapshot
      },
    }
    renderWithPlan(<PlanReview applianceId="app-1" />, slow)
    const filter = await screen.findByRole('article', { name: 'Clean the filter' })
    const arms = screen.getByRole('article', { name: 'Check the spray arms' })
    fireEvent.click(within(filter).getByRole('button', { name: 'Accept' }))
    fireEvent.click(within(arms).getByRole('button', { name: 'Reject' }))
    await act(() => new Promise((resolve) => setTimeout(resolve, 80)))
    expect(within(arms).getByRole('button', { name: 'Reject' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(filter).getByRole('button', { name: 'Accept' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('deleting a dishwasher', () => {
  it('asks first, says calendar events stay, then removes it and goes home', async () => {
    mockFetch({ configured: true, connected: true }, [])
    await addDishwasher()
    await decideAndApprove(ONE_ACCEPTED)

    renderWithPlan(<ApplianceRecordView applianceId="app-1" />, repo)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete this appliance' }))
    expect(screen.getByText(/Events already in Google Calendar stay there/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect((await repo.load()).records).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Delete this appliance' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete' })))
    expect(push).toHaveBeenLastCalledWith('/')
    expect((await repo.load()).records).toEqual([])
  })
})

describe('disconnecting Google Calendar', () => {
  it('revokes access from the dishwasher page and says events stay', async () => {
    const calls: Calls = []
    mockFetch({ configured: true, connected: true }, calls)
    await addDishwasher()
    await decideAndApprove(ONE_ACCEPTED)

    renderWithPlan(<ApplianceRecordView applianceId="app-1" />, repo)
    const disconnect = await screen.findByRole('button', { name: 'Disconnect Google Calendar from Keeply' })
    await act(async () => fireEvent.click(disconnect))
    expect(calls.some((c) => c.url === '/api/calendar/disconnect')).toBe(true)
    expect(await screen.findByText(/Events already added stay in your calendar/)).toBeInTheDocument()
  })
})

describe('manufacturer guidance on the plan screen', () => {
  it('shows Manufacturer verified with its quote and link', async () => {
    mockFetch({ configured: false, connected: false }, [])
    renderWithPlan(<NewApplianceForm />, repo, undefined, {
      proposer: async () => [
        {
          name: 'Clean the filters',
          instructions: 'Check and clean the filters.',
          interval: { count: 1, unit: 'week' },
          evidenceLevel: 'manufacturer_verified',
          source: {
            type: 'manufacturer_manual',
            title: 'Bosch SMS6ZCI49E user manual',
            url: 'https://www.bosch-home.com/manual.pdf',
            location: 'page 32',
            quote: 'Check the filters for residues after each wash.',
          },
        },
      ],
    })
    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' })))
    cleanup()

    renderWithPlan(<PlanReview applianceId="app-1" />, repo)
    const card = await screen.findByRole('article', { name: 'Clean the filters' })
    expect(within(card).getByText('Manufacturer verified')).toBeInTheDocument()
    fireEvent.click(within(card).getByRole('button', { name: 'Why? / View source' }))
    expect(within(card).getByText('“Check the filters for residues after each wash.”')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://www.bosch-home.com/manual.pdf')
  })
})

describe('account panel', () => {
  const service = (account: Account, result = { ok: true } as SignInResult) => ({
    current: vi.fn(async () => account),
    onChange: () => () => {},
    signInWithGoogle: vi.fn(async () => result),
    switchToGoogleAccount: vi.fn(async () => ({ ok: true }) as const),
    signOut: vi.fn(async () => {}),
  })

  it('offers Google sign-in to an anonymous visitor', async () => {
    const accounts = service({ kind: 'anonymous' })
    renderWithPlan(<Home />, repo, undefined, { account: accounts })
    await settle()
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' })))
    expect(accounts.signInWithGoogle).toHaveBeenCalled()
  })

  it('offers to switch when that Google login already has Keeply', async () => {
    const accounts = service({ kind: 'anonymous' }, { ok: false, reason: 'already_registered', message: 'That Google account already has Keeply plans.' })
    renderWithPlan(<Home />, repo, undefined, { account: accounts })
    await settle()
    await act(async () => fireEvent.click(await screen.findByRole('button', { name: 'Sign in with Google' })))
    expect(screen.getByRole('alert')).toHaveTextContent(/already has Keeply/)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch to that account' })))
    expect(accounts.switchToGoogleAccount).toHaveBeenCalled()
  })

  it('shows who is signed in and signs out', async () => {
    const accounts = service({ kind: 'google', email: 'r@example.com', name: 'R' })
    renderWithPlan(<Home />, repo, undefined, { account: accounts })
    expect(await screen.findByText(/Signed in as r@example.com/)).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(accounts.signOut).toHaveBeenCalled()
  })

  it('is hidden in device-only mode', async () => {
    renderWithPlan(<Home />, repo)
    await screen.findByText('No appliances yet.')
    expect(screen.queryByRole('button', { name: 'Sign in with Google' })).not.toBeInTheDocument()
  })
})
