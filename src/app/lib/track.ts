import type { Decision } from '@/domain/plan'

// Validation funnel from docs/HANDOFF.md §15. Ids and counts only: no names, models or dates.
// Scan and identification events arrive with Phase 2.
export type FunnelEvent =
  | { name: 'appliance_added'; applianceId: string }
  | { name: 'recommendations_generated'; applianceId: string; count: number }
  | { name: 'recommendation_decided'; applianceId: string; decision: Decision['kind'] }
  | { name: 'plan_approved'; applianceId: string; approved: number; skipped: number }
  | { name: 'calendar_tasks_created'; applianceId: string; count: number }
  | { name: 'task_completed'; applianceId: string }

export type TrackedEvent = FunnelEvent & { at: string }

// Where events go. A Supabase sink (an events table) can replace the default later.
export type EventSink = (event: TrackedEvent) => void

export const noopSink: EventSink = () => {}

export const devConsoleSink: EventSink = (event) => console.debug('[keeply:event]', event)

export function defaultSink(): EventSink {
  return process.env.NODE_ENV === 'development' ? devConsoleSink : noopSink
}

// Tracking must never break the product flow.
export function safeTrack(sink: EventSink, event: FunnelEvent, now = () => new Date().toISOString()) {
  try {
    sink({ ...event, at: now() })
  } catch {
    // ignored
  }
}
