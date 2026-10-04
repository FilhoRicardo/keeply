'use client'

import { useSyncExternalStore } from 'react'
import { EMPTY_STATE, parseState, type PlanState } from './plan-state'

// Browser-storage persistence for the plan until the Supabase project exists (see src/db/README.md).
const STORAGE_KEY = 'keeply.plan.v1'

let cached: { raw: string | null; state: PlanState } | null = null
const listeners = new Set<() => void>()

function read(): PlanState {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!cached || cached.raw !== raw) cached = { raw, state: parseState(raw) }
  return cached.state
}

export function getPlanState(): PlanState {
  return typeof window === 'undefined' ? EMPTY_STATE : read()
}

export function updatePlanState(update: (state: PlanState) => PlanState): PlanState {
  const next = update(read())
  const raw = JSON.stringify(next)
  window.localStorage.setItem(STORAGE_KEY, raw)
  cached = { raw, state: next }
  listeners.forEach((l) => l())
  return next
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => e.key === STORAGE_KEY && listener()
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

// Returns null during server render and hydration, the stored state afterwards.
export function usePlanState(): PlanState | null {
  return useSyncExternalStore(subscribe, read, () => null)
}

export function resetPlanStoreForTests() {
  cached = null
  window.localStorage.removeItem(STORAGE_KEY)
}
