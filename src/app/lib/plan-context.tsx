'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { Decision } from '@/domain/plan'
import type { PlanRepository } from './plan-repository'
import { createPlanRepository } from './repository'
import { findRecord, type NewApplianceInput, type PlanState } from './plan-state'
import { defaultSink, safeTrack, type EventSink } from './track'

type PlanContextValue = {
  // null until the repository has loaded (server render, hydration, network).
  state: PlanState | null
  // Last storage failure, shown in a banner with a retry.
  error: string | null
  retry(): void
  storageKind: PlanRepository['kind']
  addAppliance(input: NewApplianceInput): Promise<string>
  setDecision(applianceId: string, recommendationId: string, decision: Decision | null): Promise<PlanState>
  approve(applianceId: string, defaultStartDate: LocalDate): Promise<PlanState>
  recordCalendarResults(applianceId: string, results: readonly WriteResult[]): Promise<PlanState>
  addCompletion(applianceId: string, taskId: string, completedOn: LocalDate): Promise<PlanState>
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
  const [repo] = useState(() => repository ?? createPlanRepository())
  const [track] = useState(() => sink ?? defaultSink())
  const [state, setState] = useState<PlanState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

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
    const apply = async (pending: Promise<PlanState>) => {
      try {
        const next = await pending
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
      async addAppliance(input) {
        let added: Awaited<ReturnType<PlanRepository['addAppliance']>>
        try {
          added = await repo.addAppliance(input)
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
        const next = await apply(repo.setDecision(applianceId, recommendationId, decision))
        if (decision) safeTrack(track, { name: 'recommendation_decided', applianceId, decision: decision.kind })
        return next
      },
      async approve(applianceId, start) {
        const next = await apply(repo.approve(applianceId, start))
        const tasks = findRecord(next, applianceId)?.tasks ?? []
        const approved = tasks.filter((t) => t.status === 'approved').length
        safeTrack(track, { name: 'plan_approved', applianceId, approved, skipped: tasks.length - approved })
        return next
      },
      async recordCalendarResults(applianceId, results) {
        const next = await apply(repo.recordCalendarResults(applianceId, results))
        const count = results.filter((r) => r.ok).length
        if (count > 0) safeTrack(track, { name: 'calendar_tasks_created', applianceId, count })
        return next
      },
      async addCompletion(applianceId, taskId, date) {
        const next = await apply(repo.addCompletion(applianceId, taskId, date))
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
