import type { WriteResult } from '@/calendar/writer'
import type { LocalDate } from '@/domain/dates'
import type { CatalogEntry } from '@/domain/guidance'
import type { Customisation, Decision } from '@/domain/plan'
import {
  addAppliance,
  addCompletion,
  approve,
  removeAppliance,
  setTaskPaused,
  clearCalendarEvents,
  updateTaskSchedule,
  parseState,
  recordCalendarResults,
  setDecision,
  type ApplianceRecord,
  type NewApplianceInput,
  type PlanState,
} from './plan-state'

// Where plans are kept. The UI only talks to this interface, so the device adapter below
// can be swapped for a Supabase adapter (src/db) without touching any screen.
// Every mutation resolves to the full, current PlanState.
export interface PlanRepository {
  readonly kind: 'device' | 'supabase'
  load(): Promise<PlanState>
  addAppliance(input: NewApplianceInput): Promise<{ state: PlanState; applianceId: string }>
  setDecision(applianceId: string, recommendationId: string, decision: Decision | null): Promise<PlanState>
  // The Approval action. The only way Tasks come into existence.
  approve(applianceId: string, defaultStartDate: LocalDate): Promise<PlanState>
  recordCalendarResults(applianceId: string, results: readonly WriteResult[]): Promise<PlanState>
  addCompletion(applianceId: string, taskId: string, completedOn: LocalDate, notes?: string | null): Promise<PlanState>
  // Changes the owner's schedule on an approved Task (the Recommendation never changes).
  updateTaskSchedule(applianceId: string, taskId: string, schedule: Customisation): Promise<PlanState>
  // Pause (event comes off the calendar) or resume a Task.
  setTaskPaused(applianceId: string, taskId: string, paused: boolean): Promise<PlanState>
  clearCalendarEvents(applianceId: string, taskIds: readonly string[]): Promise<PlanState>
  // Removes the appliance and everything under it from Keeply (not from the calendar).
  deleteAppliance(applianceId: string): Promise<PlanState>
  // Supabase only: copy a plan kept on this device into the account (identity, recommendations,
  // decisions, tasks, completions, photo). Task ids are kept so calendar events stay linked.
  importRecord?(record: ApplianceRecord): Promise<void>
  // Bearer token for server routes that act on this user's plan (Supabase only).
  accessToken?(): Promise<string | null>
  // Optional change feed (other tabs, realtime). Listener should reload.
  subscribe?(listener: () => void): () => void
}

export const DEVICE_STORAGE_KEY = 'keeply.plan.v1'

// Photos above this are not kept in device storage (localStorage is ~5 MB in total).
export const DEVICE_PHOTO_LIMIT = 300_000

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`
}

// Decodes without fetch(): the production CSP's connect-src does not allow data: URLs.
export function dataUrlToBlob(url: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(url)
  if (!match) throw new Error('Not a data URL.')
  const [, type, base64, payload] = match
  const binary = base64 ? atob(payload) : decodeURIComponent(payload)
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new Blob([bytes], { type: type || 'application/octet-stream' })
}

type KeyValueStorage =Pick<Storage, 'getItem' | 'setItem'>

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
  catalog = [],
}: {
  storage?: KeyValueStorage | null
  newId?: () => string
  now?: () => string
  // Curated guidance available offline; empty unless the team ships verified entries.
  catalog?: readonly CatalogEntry[]
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
    async addAppliance(input) {
      const applianceId = newId()
      const photo = input.photo && input.photo.size <= DEVICE_PHOTO_LIMIT ? await blobToDataUrl(input.photo) : null
      return { state: write(addAppliance(read(), input, applianceId, now(), photo, catalog)), applianceId }
    },
    setDecision: (applianceId, recommendationId, decision) =>
      mutate((s) => setDecision(s, applianceId, recommendationId, decision)),
    approve: (applianceId, defaultStartDate) => mutate((s) => approve(s, applianceId, defaultStartDate, newId, now())),
    recordCalendarResults: (applianceId, results) => mutate((s) => recordCalendarResults(s, applianceId, results)),
    addCompletion: (applianceId, taskId, completedOn, notes) =>
      mutate((s) => addCompletion(s, applianceId, taskId, completedOn, notes ?? null)),
    deleteAppliance: (applianceId) => mutate((s) => removeAppliance(s, applianceId)),
    setTaskPaused: (applianceId, taskId, paused) => mutate((s) => setTaskPaused(s, applianceId, taskId, paused)),
    clearCalendarEvents: (applianceId, taskIds) => mutate((s) => clearCalendarEvents(s, applianceId, taskIds)),
    updateTaskSchedule: (applianceId, taskId, schedule) => mutate((s) => updateTaskSchedule(s, applianceId, taskId, schedule)),
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
