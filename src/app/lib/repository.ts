import { createClient } from '@supabase/supabase-js'
import { createDevicePlanRepository, type PlanRepository } from './plan-repository'
import { createSupabasePlanRepository } from './supabase-plan-repository'
import { defaultSink, supabaseSink, type EventSink } from './track'

type Env = { url?: string; anonKey?: string }

const ENV: Env = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY }

// Supabase when the project is configured, device storage otherwise (local dev, previews).
// v0.1 signs visitors in anonymously: no account screen, RLS still isolates each visitor.
export type PlanBackend = {
  repository: PlanRepository
  sink: EventSink
  // With Supabase: plans saved on this device before the account existed, offered for import.
  device?: PlanRepository
}

export function createPlanBackend(env: Env = ENV): PlanBackend {
  if (!env.url || !env.anonKey || typeof window === 'undefined') {
    return { repository: createDevicePlanRepository(), sink: defaultSink() }
  }
  const db = createClient(env.url, env.anonKey)
  const repository = createSupabasePlanRepository({
    db,
    async ensureSession() {
      const { data } = await db.auth.getSession()
      if (data.session) return
      const { error } = await db.auth.signInAnonymously()
      if (error) throw new Error(`Could not start a Keeply session: ${error.message}`)
    },
  })
  return { repository, sink: supabaseSink(db, () => repository.accessToken!()), device: createDevicePlanRepository() }
}

export function createPlanRepository(env: Env = ENV): PlanRepository {
  return createPlanBackend(env).repository
}
