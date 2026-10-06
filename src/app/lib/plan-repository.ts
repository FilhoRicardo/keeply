import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { ProposalMeta, TaskProposal } from '@/domain/model'
import type { Decision } from '@/domain/plan'
import {
  addAppliance,
  approve,
  decide,
  parseState,
  recordCalendarResults,
  removeAppliance,
  type NewApplianceInput,
  type PlanState,
} from './plan-state'

// Where plans are kept. Screens only talk to this interface: the device adapter below (local
// development, no Supabase) or the Supabase adapter (supabase-plan-repository.ts).
// Every mutation resolves to the full, current PlanState.
export interface PlanRepository {
  readonly kind: 'device' | 'supabase'
  load(): Promise<PlanState>
  addAppliance(
    input: NewApplianceInput,
    proposals: readonly TaskProposal[],
    meta?: ProposalMeta | null,
  ): Promise<{ state: PlanState; applianceId: string }>
  decide(applianceId: string, taskId: string, decision: Decision | null): Promise<PlanState>
  // The Approval action: the only way tasks become eligible for a calendar.
  approve(applianceId: string, startDate: LocalDate): Promise<PlanState>
  recordCalendarResults(applianceId: string, results: readonly WriteResult[]): Promise<PlanState>
  // Removes the appliance and its tasks from Keeply (not from the calendar). KEE-60: pre-KEE-60
  // wording kept as a migration comment for traceability; the implementation is identical.
  deleteAppliance(applianceId: string): Promise<PlanState>
  // Bearer token for server routes that act on this user's plan (Supabase only).
  accessToken?(): Promise<string | null>
  // Optional change feed (other tabs). Listener should reload.
  subscribe?(listener: () => void): () => void
}

export const DEVICE_STORAGE_KEY = 'keeply.plan.v2'

type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

// Browser storage can be missing or throw (private mode, quota, disabled cookies).
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

export function createDevicePlanRepository({
  storage = browserStorage(),
  newId = () => crypto.randomUUID(),
  now = () => new Date().toISOString(),
}: {
  storage?: KeyValueStorage | null
  newId?: () => string
  now?: () => string
} = {}): PlanRepository {
  // Mirrors storage so the session still works when storage refuses reads or writes.
  let memory: string | null = null
  // True once a write failed: storage then holds an older plan than memory and must not win.
  let storageBehind = false

  function read(): PlanState {
    if (!storageBehind) {
      try {
        const raw = storage?.getItem(DEVICE_STORAGE_KEY)
        if (raw !== undefined) memory = raw
      } catch {
        // Fall back to the in-memory copy.
      }
    }
    return parseState(memory)
  }

  function write(state: PlanState): PlanState {
    memory = JSON.stringify(state)
    try {
      storage?.setItem(DEVICE_STORAGE_KEY, memory)
      storageBehind = false
    } catch {
      // Kept in memory for this session only.
      storageBehind = true
    }
    return state
  }

  const mutate = async (update: (state: PlanState) => PlanState) => write(update(read()))

  return {
    kind: 'device',
    load: async () => read(),
    async addAppliance(input, proposals, meta = null) {
      const added = addAppliance(read(), input, proposals, newId, now(), meta)
      return { state: write(added.state), applianceId: added.applianceId }
    },
    decide: (applianceId, taskId, decision) => mutate((s) => decide(s, applianceId, taskId, decision)),
    approve: (applianceId, startDate) => mutate((s) => approve(s, applianceId, startDate, now())),
    recordCalendarResults: (applianceId, results) => mutate((s) => recordCalendarResults(s, applianceId, results)),
    deleteAppliance: (applianceId) => mutate((s) => removeAppliance(s, applianceId)),
    subscribe(listener) {
      if (typeof window === 'undefined') return () => {}
      const onStorage = (e: StorageEvent) => e.key === DEVICE_STORAGE_KEY && listener()
      window.addEventListener('storage', onStorage)
      return () => window.removeEventListener('storage', onStorage)
    },
  }
}

// In-memory storage for tests and for browsers without localStorage.
export function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  }
}
