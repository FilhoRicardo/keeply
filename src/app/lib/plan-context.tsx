'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { Customisation, Decision } from '@/domain/plan'
import type { PlanRepository } from './plan-repository'
import { deviceAccount, type Account, type AccountService, type SignInResult } from './account'
import { createPlanBackend, type PlanBackend } from './repository'
import { findRecord, type NewApplianceInput, type PlanState } from './plan-state'
import { defaultSink, safeTrack, type EventSink } from './track'

type PlanContextValue = {
  // null until the repository has loaded (server render, hydration, network).
  state: PlanState | null
  // Who is signed in (device / anonymous / Google) and how to change it.
  account: Account | null
  // A Google sign-in that failed after the redirect back (e.g. login already has Keeply).
  signInProblem: SignInResult | null
  signInWithGoogle(): Promise<SignInResult>
  switchToGoogleAccount(): Promise<SignInResult>
  signOut(): Promise<void>
  // Dishwashers saved only on this device that can move into the Supabase account.
  pendingImport: number
  importDevicePlan(): Promise<void>
  // Last storage failure, shown in a banner with a retry.
  error: string | null
  retry(): void
  storageKind: PlanRepository['kind']
  // Supabase session token for server routes; null with device storage.
  accessToken(): Promise<string | null>
  addAppliance(input: NewApplianceInput): Promise<string>
  setDecision(applianceId: string, recommendationId: string, decision: Decision | null): Promise<PlanState>
  approve(applianceId: string, defaultStartDate: LocalDate): Promise<PlanState>
  recordCalendarResults(applianceId: string, results: readonly WriteResult[]): Promise<PlanState>
  addCompletion(applianceId: string, taskId: string, completedOn: LocalDate, notes?: string | null): Promise<PlanState>
  deleteAppliance(applianceId: string): Promise<PlanState>
  updateTaskSchedule(applianceId: string, taskId: string, schedule: Customisation): Promise<PlanState>
  setTaskPaused(applianceId: string, taskId: string, paused: boolean): Promise<PlanState>
  clearCalendarEvents(applianceId: string, taskIds: readonly string[]): Promise<PlanState>
}

const PlanContext = createContext<PlanContextValue | null>(null)

// Runs `op` after everything already queued, whether that succeeded or failed.
function enqueue<T>(queue: { current: Promise<unknown> }, op: () => Promise<T>): Promise<T> {
  const run = queue.current.then(op, op)
  queue.current = run.catch(() => {})
  return run
}

export function PlanProvider({
  repository,
  sink,
  device,
  account: accountService,
  children,
}: {
  repository?: PlanRepository
  sink?: EventSink
  device?: PlanRepository
  account?: AccountService
  children: ReactNode
}) {
  const [backend] = useState<PlanBackend>(() =>
    repository
      ? { repository, sink: sink ?? defaultSink(), device, account: accountService ?? deviceAccount }
      : createPlanBackend(),
  )
  const repo = backend.repository
  const track = sink ?? backend.sink
  const [state, setState] = useState<PlanState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [pendingImport, setPendingImport] = useState(0)
  const [account, setAccount] = useState<Account | null>(null)
  const [signInProblem, setSignInProblem] = useState<SignInResult | null>(null)

  useEffect(() => {
    let live = true
    backend.account.redirectProblem?.().then((p) => live && p && setSignInProblem(p), () => {})
    return () => {
      live = false
    }
  }, [backend.account])

  // Track the signed-in account; a sign-in or sign-out changes whose plans are shown.
  useEffect(() => {
    let live = true
    const refresh = () => backend.account.current().then((a) => live && setAccount(a), () => {})
    refresh()
    const unsubscribe = backend.account.onChange(() => {
      refresh()
      setAttempt((n) => n + 1)
    })
    return () => {
      live = false
      unsubscribe()
    }
  }, [backend.account])
  // Mutations run one at a time, so a slower earlier response can never overwrite a newer state.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    if (!backend.device || !repo.importRecord) return
    backend.device.load().then((s) => setPendingImport(s.records.length), () => setPendingImport(0))
  }, [backend.device, repo])

  // Google OAuth returns with ?calendar=connected: record it once and tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('calendar') !== 'connected') return
    safeTrack(track, { name: 'calendar_connected' })
    url.searchParams.delete('calendar')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [track])

  useEffect(() => {
    let live = true
    // Queued with mutations, so a load that started before a mutation cannot land after it.
    const reload = () =>
      enqueue(queue, () => repo.load()).then(
        (s) => {
          if (!live) return
          setState(s)
          setError(null)
        },
        (e: unknown) => live && setError(e instanceof Error ? e.message : String(e)),
      )
    reload()
    const unsubscribe = repo.subscribe?.(reload)
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [repo, attempt])

  const value = useMemo<PlanContextValue>(() => {
    const serial = <T,>(op: () => Promise<T>): Promise<T> => enqueue(queue, op)
    const apply = async (op: () => Promise<PlanState>) => {
      try {
        const next = await serial(op)
        setState(next)
        setError(null)
        return next
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        throw e
      }
    }
    return {
      state,
      error,
      retry: () => setAttempt((n) => n + 1),
      pendingImport,
      account,
      signInProblem,
      signInWithGoogle: () => backend.account.signInWithGoogle(),
      switchToGoogleAccount: () => backend.account.switchToGoogleAccount(),
      async signOut() {
        await backend.account.signOut()
        setState(null)
        setAttempt((n) => n + 1)
      },
      async importDevicePlan() {
        const { device } = backend
        if (!device || !repo.importRecord) return
        await apply(async () => {
          // One appliance at a time, each removed from the device only once it is safely imported,
          // so a retry after a failure never duplicates what already moved.
          for (const record of (await device.load()).records) {
            await repo.importRecord!(record)
            await device.deleteAppliance(record.appliance.id)
            setPendingImport((n) => Math.max(0, n - 1))
          }
          return repo.load()
        })
      },
      storageKind: repo.kind,
      accessToken: () => repo.accessToken?.() ?? Promise.resolve(null),
      async addAppliance(input) {
        let added: Awaited<ReturnType<PlanRepository['addAppliance']>>
        try {
          added = await serial(() => repo.addAppliance(input))
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
          throw e
        }
        const { state: next, applianceId } = added
        setState(next)
        setError(null)
        safeTrack(track, { name: 'appliance_added', applianceId })
        const count = findRecord(next, applianceId)?.recommendations.length ?? 0
        safeTrack(track, { name: 'recommendations_generated', applianceId, count })
        return applianceId
      },
      async setDecision(applianceId, recommendationId, decision) {
        const next = await apply(() => repo.setDecision(applianceId, recommendationId, decision))
        if (decision) safeTrack(track, { name: 'recommendation_decided', applianceId, decision: decision.kind })
        return next
      },
      async approve(applianceId, start) {
        const next = await apply(() => repo.approve(applianceId, start))
        const tasks = findRecord(next, applianceId)?.tasks ?? []
        const approved = tasks.filter((t) => t.status === 'approved').length
        safeTrack(track, { name: 'plan_approved', applianceId, approved, skipped: tasks.length - approved })
        return next
      },
      async recordCalendarResults(applianceId, results) {
        const next = await apply(() => repo.recordCalendarResults(applianceId, results))
        const count = results.filter((r) => r.ok).length
        if (count > 0) safeTrack(track, { name: 'calendar_tasks_created', applianceId, count })
        return next
      },
      deleteAppliance: (applianceId) => apply(() => repo.deleteAppliance(applianceId)),
      setTaskPaused: (applianceId, taskId, paused) => apply(() => repo.setTaskPaused(applianceId, taskId, paused)),
      clearCalendarEvents: (applianceId, taskIds) => apply(() => repo.clearCalendarEvents(applianceId, taskIds)),
      updateTaskSchedule: (applianceId, taskId, schedule) => apply(() => repo.updateTaskSchedule(applianceId, taskId, schedule)),
      async addCompletion(applianceId, taskId, date, notes) {
        const next = await apply(() => repo.addCompletion(applianceId, taskId, date, notes))
        safeTrack(track, { name: 'task_completed', applianceId })
        return next
      },
    }
  }, [repo, state, error, track, pendingImport, backend, account, signInProblem])

  return (
    <PlanContext.Provider value={value}>
      {error && (
        <div className="error-banner" role="alert">
          <span>Keeply could not reach your plan. {error}</span>
          <button type="button" className="link-button" onClick={value.retry}>
            Try again
          </button>
        </div>
      )}
      {children}
    </PlanContext.Provider>
  )
}

export function usePlan(): PlanContextValue {
  const value = useContext(PlanContext)
  if (!value) throw new Error('usePlan must be used inside <PlanProvider>')
  return value
}
