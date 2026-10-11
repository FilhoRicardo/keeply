'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { Decision } from '@/domain/plan'
import type { PlanRepository } from './plan-repository'
import { deviceAccount, type Account, type AccountService, type SignInResult } from './account'
import { createPlanBackend, type PlanBackend } from './repository'
import { findRecord, type NewApplianceInput, type PlanState } from './plan-state'
import { livePlanProposer, type PlanProposer } from './propose'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import { defaultSink, safeTrack, type EventSink, type FunnelEvent } from './track'

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
  // Last storage failure, shown in a banner with a retry.
  error: string | null
  retry(): void
  storageKind: PlanRepository['kind']
  // Supabase session token for server routes; null with device storage.
  accessToken(): Promise<string | null>
  track(event: FunnelEvent): void
  // Finds the plan for the confirmed appliance and saves it. Resolves to a typed result:
  //   - 'added'   — the appliance was saved; `applianceId` is ready for the plan screen.
  //   - 'no_plan' — the proposer returned an empty plan and the dishwasher general-guidance
  //                 fallback does not apply. `meta` is the outcome the proposer already
  //                 produced, or null when a stub proposer returned a bare list. Nothing is
  //                 saved and no appliance_added event is emitted. Callers MUST handle this
  //                 branch. The provider's error banner stays reserved for thrown failures.
  // Other failures (network, storage, validation) still throw and are surfaced by the banner.
  addAppliance(
    input: NewApplianceInput,
    scanned?: boolean,
  ): Promise<{ kind: 'added'; applianceId: string } | { kind: 'no_plan'; meta: ProposalMeta | null }>
  decide(applianceId: string, taskId: string, decision: Decision | null): Promise<PlanState>
  approve(applianceId: string, startDate: LocalDate): Promise<PlanState>
  recordCalendarResults(applianceId: string, results: readonly WriteResult[]): Promise<PlanState>
  deleteAppliance(applianceId: string): Promise<PlanState>
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
  account: accountService,
  proposer = livePlanProposer,
  children,
}: {
  repository?: PlanRepository
  sink?: EventSink
  account?: AccountService
  // A test can pass a stub proposer that returns plain TaskProposal[]; the live default returns
  // { proposals, meta } so the plan page can render an honest outcome (KEE-43).
  proposer?: PlanProposer
  children: ReactNode
}) {
  const [backend] = useState<PlanBackend>(() =>
    repository ? { repository, sink: sink ?? defaultSink(), account: accountService ?? deviceAccount } : createPlanBackend(),
  )
  const repo = backend.repository
  const sinkRef = sink ?? backend.sink
  const [state, setState] = useState<PlanState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
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

  // Google OAuth returns with ?calendar=connected: record it once and tidy the URL.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('calendar') !== 'connected') return
    safeTrack(sinkRef, { name: 'calendar_connected' })
    url.searchParams.delete('calendar')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [sinkRef])

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

  // Stable, so screens can depend on it in effects.
  const accessToken = useCallback(() => repo.accessToken?.() ?? Promise.resolve(null), [repo])

  const value = useMemo<PlanContextValue>(() => {
    const apply = async (op: () => Promise<PlanState>) => {
      try {
        const next = await enqueue(queue, op)
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
      account,
      signInProblem,
      signInWithGoogle: () => backend.account.signInWithGoogle(),
      switchToGoogleAccount: () => backend.account.switchToGoogleAccount(),
      async signOut() {
        await backend.account.signOut()
        setState(null)
        setAttempt((n) => n + 1)
      },
      storageKind: repo.kind,
      accessToken,
      track: (event) => safeTrack(sinkRef, event),
      async addAppliance(input, scanned = false) {
        // The live proposer returns { proposals, meta }; a stub returns TaskProposal[].
        // KEE-60: the category comes from the AI read or the owner's manual entry; the
        // proposer uses it to decide between the dishwasher general-guidance fallback and
        // an honest empty plan for everything else. An empty proposals list is a legitimate
        // outcome (no manual was found and the dishwasher fallback does not apply), not a
        // failure — return it as a typed result so the provider's error banner stays for
        // network and storage failures only.
        const raw = await proposer(
          { manufacturer: input.manufacturer.trim(), model: input.model.trim() || null, category: input.category ?? null },
          { accessToken },
        )
        const { proposals, meta }: { proposals: TaskProposal[]; meta: ProposalMeta | null } = Array.isArray(raw)
          ? { proposals: raw, meta: null }
          : raw
        if (proposals.length === 0) {
          return { kind: 'no_plan' as const, meta }
        }
        // Capture the new id through the closure so `apply` can keep its `PlanState` return
        // type; the no_plan branch above never enters this path.
        let applianceId = ''
        await apply(async () => {
          const added = await repo.addAppliance(input, proposals, meta)
          applianceId = added.applianceId
          return added.state
        })
        safeTrack(sinkRef, { name: 'appliance_added', scanned })
        safeTrack(sinkRef, {
          name: 'plan_proposed',
          tasks: proposals.length,
          verified: proposals.filter((p) => p.evidenceLevel === 'manufacturer_verified').length,
        })
        return { kind: 'added' as const, applianceId }
      },
      decide: (applianceId, taskId, decision) => apply(() => repo.decide(applianceId, taskId, decision)),
      async approve(applianceId, startDate) {
        const next = await apply(() => repo.approve(applianceId, startDate))
        const tasks = findRecord(next, applianceId)?.tasks ?? []
        const accepted = tasks.filter((t) => t.status === 'accepted').length
        safeTrack(sinkRef, { name: 'plan_approved', accepted, rejected: tasks.length - accepted })
        return next
      },
      async recordCalendarResults(applianceId, results) {
        const next = await apply(() => repo.recordCalendarResults(applianceId, results))
        const count = results.filter((r) => r.ok).length
        if (count > 0) safeTrack(sinkRef, { name: 'calendar_tasks_created', count })
        return next
      },
      deleteAppliance: (applianceId) => apply(() => repo.deleteAppliance(applianceId)),
    }
  }, [repo, state, error, sinkRef, backend, account, signInProblem, proposer, accessToken])

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
