import type { SupabaseClient } from '@supabase/supabase-js'
import type { AccessDenial } from '@/domain/identification'

// Beta usage counts (docs/HANDOFF.md §15). Event names and small counts only: no names, models,
// photos or dates.
export type FunnelEvent =
  | { name: 'scan_started' }
  | { name: 'label_read'; recognised: boolean }
  // KEE-60: `plan: 'none'` is the no_plan outcome (no manual found, not a dishwasher). For
  // every other appliance (or when a manual was found) `plan` is omitted; tracking stays
  // a small counts-only funnel so no appliance-specific facts leak.
  | { name: 'appliance_added'; scanned: boolean; plan?: 'none' }
  | { name: 'plan_proposed'; tasks: number; verified: number }
  | { name: 'plan_approved'; accepted: number; rejected: number }
  | { name: 'calendar_connected' }
  | { name: 'calendar_tasks_created'; count: number }
  | { name: 'invite_redeemed' }
  | { name: 'scan_denied'; reason: AccessDenial }
  | {
      name: 'plan_search'
      outcome:
        | 'ok'
        | 'no_results'
        | 'search_error'
        | 'search_empty'
        | 'manual_found_ai_no_tasks'
        | 'quota_exhausted'
        | 'fetch_failed'
        | 'extraction_unavailable'
        | 'unreadable'
        | 'no_text'
        | 'timeout'
        | 'no_plan'
    }

export type EventSink = (event: FunnelEvent) => void

export const noopSink: EventSink = () => {}

export const devConsoleSink: EventSink = (event) => console.debug('[keeply:event]', event)

// Appends to public.funnel_events (insert-only for visitors). `ready` waits for the session.
export function supabaseSink(db: SupabaseClient, ready: () => Promise<unknown>): EventSink {
  return ({ name, ...props }) => {
    void ready()
      .then(() => db.from('funnel_events').insert({ name, props }))
      .catch(() => {})
  }
}

export function defaultSink(): EventSink {
  return process.env.NODE_ENV === 'development' ? devConsoleSink : noopSink
}

// Tracking must never break the product flow.
export function safeTrack(sink: EventSink, event: FunnelEvent) {
  try {
    sink(event)
  } catch {
    // ignored
  }
}
