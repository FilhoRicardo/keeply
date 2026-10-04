'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { Customisation, Decision } from '@/domain/plan'
import type { PlanRepository } from './plan-repository'
import { createPlanBackend } from './repository'
import { findRecord, type NewApplianceInput, type PlanState } from './plan-state'
import { defaultSink, safeTrack, type EventSink } from './track'

type PlanContextValue = {
  // null until the repository has loaded (server render, hydration, network).
  state: PlanState | null
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
  addCompletion(applianceId: string, taskId: string, completedOn: LocalDate): Promise<PlanState>
  deleteAppliance(applianceId: string): Promise<PlanState>
  updateTaskSchedule(applianceId: string, taskId: string, schedule: Customisation): Promise<PlanState>
}

const PlanContext = createContext<PlanContextValue | null>(null)

export function PlanProvider({
  repository,
  sink,
  children,
}: {
  repository?: PlanRepository
  sink?: EventSink
  children: ReactNode
}) {
  const [backend] = useState(() => (repository ? { repository, sink: sink ?? defaultSink() } : createPlanBackend()))
  const repo = backend.repository
  const track = sink ?? backend.sink
  const [state, setState] = useState<PlanState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Mutations run one at a time, so a slower earlier response can never overwrite a newer state.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

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
    const reload = () =>
      repo.load().then(
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
    const serial = <T,>(op: () => Promise<T>): Promise<T> => {
      const run = queue.current.then(op, op)
      queue.current = run.catch(() => {})
      return run
    }
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
      updateTaskSchedule: (applianceId, taskId, schedule) => apply(() => repo.updateTaskSchedule(applianceId, taskId, schedule)),
      async addCompletion(applianceId, taskId, date) {
        const next = await apply(() => repo.addCompletion(applianceId, taskId, date))
        safeTrack(track, { name: 'task_completed', applianceId })
        return next
      },
    }
  }, [repo, state, error, track])

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
