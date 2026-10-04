import { createClient } from '@supabase/supabase-js'
import { createDevicePlanRepository, type PlanRepository } from './plan-repository'
import { createSupabasePlanRepository } from './supabase-plan-repository'

// Supabase when the project is configured, device storage otherwise (local dev, previews).
// v0.1 signs visitors in anonymously: no account screen, RLS still isolates each visitor.
export function createPlanRepository(
  env: { url?: string; anonKey?: string } = {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  },
): PlanRepository {
  if (!env.url || !env.anonKey || typeof window === 'undefined') return createDevicePlanRepository()
  const db = createClient(env.url, env.anonKey)
  return createSupabasePlanRepository({
    db,
    async ensureSession() {
      const { data } = await db.auth.getSession()
      if (data.session) return
      const { error } = await db.auth.signInAnonymously()
      if (error) throw new Error(`Could not start a Keeply session: ${error.message}`)
    },
  })
}
