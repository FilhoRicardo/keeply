'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { Decision } from '@/domain/plan'
import { createDevicePlanRepository, type PlanRepository } from './plan-repository'
import type { NewApplianceInput, PlanState } from './plan-state'

type PlanContextValue = {
  // null until the repository has loaded (server render, hydration, network).
  state: PlanState | null
  storageKind: PlanRepository['kind']
  addAppliance(input: NewApplianceInput): Promise<string>
  setDecision(applianceId: string, recommendationId: string, decision: Decision | null): Promise<PlanState>
  approve(applianceId: string, defaultStartDate: LocalDate): Promise<PlanState>
  recordCalendarResults(applianceId: string, results: readonly WriteResult[]): Promise<PlanState>
  addCompletion(applianceId: string, taskId: string, completedOn: LocalDate): Promise<PlanState>
}

const PlanContext = createContext<PlanContextValue | null>(null)

export function PlanProvider({ repository, children }: { repository?: PlanRepository; children: ReactNode }) {
  const [repo] = useState(() => repository ?? createDevicePlanRepository())
  const [state, setState] = useState<PlanState | null>(null)

  useEffect(() => {
    let live = true
    const reload = () => repo.load().then((s) => live && setState(s))
    reload()
    const unsubscribe = repo.subscribe?.(reload)
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [repo])

  const value = useMemo<PlanContextValue>(() => {
    const apply = async (pending: Promise<PlanState>) => {
      const next = await pending
      setState(next)
      return next
    }
    return {
      state,
      storageKind: repo.kind,
      async addAppliance(input) {
        const { state: next, applianceId } = await repo.addAppliance(input)
        setState(next)
        return applianceId
      },
      setDecision: (a, r, d) => apply(repo.setDecision(a, r, d)),
      approve: (a, start) => apply(repo.approve(a, start)),
      recordCalendarResults: (a, results) => apply(repo.recordCalendarResults(a, results)),
      addCompletion: (a, t, date) => apply(repo.addCompletion(a, t, date)),
    }
  }, [repo, state])

  return <PlanContext.Provider value={value}>{children}</PlanContext.Provider>
}

export function usePlan(): PlanContextValue {
  const value = useContext(PlanContext)
  if (!value) throw new Error('usePlan must be used inside <PlanProvider>')
  return value
}
