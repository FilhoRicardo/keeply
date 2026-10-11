import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApplianceTree, TaskRow } from '@/db/rows'

// In-memory stand-in for the add_appliance RPC and the appliance select.
// Column names match supabase/migrations/20261011120000_proposal_meta.sql:
// the p_proposal_* arguments are the proposal_* columns a reload reads back.

type StoredArgs = {
  p_manufacturer?: string
  p_model?: string
  p_serial_number?: string
  p_identification_confidence?: number | null
  p_tasks?: Array<Record<string, unknown>>
  p_proposal_fallback?: string | null
  p_proposal_search_outcome?: string | null
  p_proposal_search_reason?: string | null
  p_proposal_searched?: boolean | null
}

function textOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' ? value : null
}

export function createFakeSupabasePlanDb(): SupabaseClient {
  const rows: ApplianceTree[] = []
  let next = 0

  const db = {
    from(table: string) {
      if (table !== 'appliances') throw new Error(`unexpected table ${table}`)
      let id: string | null = null
      const builder = {
        select() {
          return builder
        },
        order() {
          return Promise.resolve({
            data: rows.map((row) => ({ ...row, maintenance_tasks: [...row.maintenance_tasks] })),
            error: null,
          })
        },
        eq(column: string, value: string) {
          if (column !== 'id') throw new Error(`unexpected eq ${column}`)
          id = value
          return builder
        },
        maybeSingle() {
          return Promise.resolve({ data: rows.find((row) => row.id === id) ?? null, error: null })
        },
      }
      return builder
    },
    rpc(name: string, args: StoredArgs) {
      if (name !== 'add_appliance') return Promise.resolve({ data: null, error: { message: `unexpected rpc ${name}` } })
      next += 1
      const id = `app-${next}`
      const model = (args.p_model ?? '').trim()
      const serial = (args.p_serial_number ?? '').trim()
      const tasks: TaskRow[] = (args.p_tasks ?? []).map((task, index) => ({
        id: `${id}-task-${index + 1}`,
        appliance_id: id,
        position: index + 1,
        name: String(task.name),
        instructions: String(task.instructions),
        interval_count: Number(task.interval_count),
        interval_unit: task.interval_unit as TaskRow['interval_unit'],
        evidence_level: task.evidence_level as TaskRow['evidence_level'],
        source_type: task.source_type as TaskRow['source_type'],
        source_title: String(task.source_title),
        source_url: (task.source_url as string | null) ?? null,
        source_location: (task.source_location as string | null) ?? null,
        source_quote: (task.source_quote as string | null) ?? null,
        status: 'proposed',
        calendar_event_id: null,
        created_at: '2026-10-11T00:00:00Z',
      }))
      rows.push({
        id,
        user_id: 'owner',
        manufacturer: (args.p_manufacturer ?? '').trim(),
        model: model.length > 0 ? model : null,
        serial_number: serial.length > 0 ? serial : null,
        identification_confidence: args.p_identification_confidence ?? null,
        approved_at: null,
        start_date: null,
        created_at: '2026-10-11T00:00:00Z',
        proposal_fallback: textOrNull(args.p_proposal_fallback),
        proposal_search_outcome: textOrNull(args.p_proposal_search_outcome),
        proposal_search_reason: textOrNull(args.p_proposal_search_reason),
        proposal_searched: typeof args.p_proposal_searched === 'boolean' ? args.p_proposal_searched : null,
        maintenance_tasks: tasks,
      })
      return Promise.resolve({ data: id, error: null })
    },
    auth: {
      getSession: async () => ({ data: { session: null } }),
    },
  }
  return db as unknown as SupabaseClient
}
