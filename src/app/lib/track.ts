import type { SupabaseClient } from '@supabase/supabase-js'

// Beta usage counts (docs/HANDOFF.md §15). Event names and small counts only: no names, models,
// photos or dates.
export type FunnelEvent =
  | { name: 'scan_started' }
  | { name: 'label_read'; recognised: boolean }
  | { name: 'appliance_added'; scanned: boolean }
  | { name: 'plan_proposed'; tasks: number; verified: number }
  | { name: 'plan_approved'; accepted: number; rejected: number }
  | { name: 'calendar_connected' }
  | { name: 'calendar_tasks_created'; count: number }

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
