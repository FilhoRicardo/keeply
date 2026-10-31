// KEE-44: the G10 evidence row schema. `scripts/live-plan-check.mjs` collects a /api/plan response,
// the visible per-task state on the plan page, and (for the calendar case) a Supabase row, then
// passes them to `buildG10Row` to produce the single row that is pasted into `docs/live-gates.md`.
//
// The shape is intentionally small: one row per case, every field a string, never a full plan.
// The G10 pass criteria (docs/live-gates.md) are read against these field names, so renaming a
// field here is a docs change in the same PR.

export type G10CaseName =
  | 'exact-manual'
  | 'similar-only'
  | 'no-manual'
  | 'scanned-pdf'
  | 'brave-fail'
  // Historical G10 case id. The failure under test is now an OpenRouter extraction failure (RF-357).
  | 'minimax-fail'
  | 'calendar-write'

export const G10_CASES: readonly G10CaseName[] = [
  'exact-manual',
  'similar-only',
  'no-manual',
  'scanned-pdf',
  'brave-fail',
  'minimax-fail',
  'calendar-write',
] as const

export type G10QuoteCheck = 'pass' | 'fail' | 'n/a'

export type G10Fallback = 'exact' | 'similar' | 'general'

export type G10SearchOutcome =
  | 'ok'
  | 'no_results'
  | 'quota_exhausted'
  | 'fetch_failed'
  | 'extraction_unavailable'
  | 'unreadable'
  | 'no_text'
  | 'timeout'
  | 'unavailable'

// The /api/plan response the orchestration returns. Only the fields the G10 row needs are typed;
// the route returns more, which the harness discards.
export type G10PlanResponse = {
  proposals: ReadonlyArray<{
    name: string
    evidenceLevel: 'manufacturer_verified' | 'similar_model' | 'general_guidance'
    source: { title: string; url: string | null }
  }>
  fallback: G10Fallback
  searchOutcome: G10SearchOutcome
}

// What the harness sees in the DOM. One row per task; the rendered text is what the user sees
// (the evidence label is the human string from src/domain/evidence.ts:evidenceLabel).
export type G10VisibleTask = {
  name: string
  evidenceLabelRendered: 'Manufacturer verified' | 'Similar-model inference' | 'General guidance'
  quoteText: string | null
}

// One observed fact. The harness records an array of these — one per Manufacturer verified task
// in the case — by reading the source text back and running verifyQuote (src/domain/evidence-check)
// outside the route. The point is the G10 pass criteria need "the code, not the model, found the
// quote in the document text"; this captures that.
export type G10QuoteObservation = {
  taskName: string
  result: G10QuoteCheck
  // The verbatim text the code looked for; n/a when the task is not Manufacturer verified.
  quote: string | null
}

export type G10RowInput = {
  case: G10CaseName
  query: { manufacturer: string; model: string | null }
  applianceId: string | null
  response: G10PlanResponse
  visibleTasks: readonly G10VisibleTask[]
  quoteObservations: readonly G10QuoteObservation[]
  timeToPlanMs: number | null
  // Set only for the calendar-write case.
  calendarEventId: string | null
  // Filled by the runner when a defect was found (KEE-… identifier), or null.
  defect: string | null
}

// The shape of one row in the G10 evidence table. Field order matches the table in
// docs/live-gates.md so the runner can paste a JSON dump straight into a Markdown row.
export type G10Row = {
  case: G10CaseName
  query: string
  applianceId: string
  chosenSourceTitle: string
  chosenSourceUrl: string
  extractedTasks: string
  quoteCheck: G10QuoteCheck
  fallback: G10Fallback | 'n/a'
  searchOutcome: G10SearchOutcome | 'n/a'
  timeToPlanMs: string
  calendarEventId: string
  defect: string
}

const TIME_TARGET_MS = 60_000

// True when the case is one of the failure cases whose time-to-plan is exempt from the magic-minute
// target (per docs/live-gates.md G10 pass criteria).
function isFailureCase(case_: G10CaseName): boolean {
  return case_ === 'brave-fail' || case_ === 'minimax-fail'
}

function summariseTasks(
  visibleTasks: readonly G10VisibleTask[],
  response: G10PlanResponse,
): string {
  // Prefer the route response (server truth) for the level, the DOM observation for the rendered
  // label. If they disagree the G10 pass criterion #3 has been violated and the row says so.
  const parts: string[] = []
  for (const visible of visibleTasks) {
    const server = response.proposals.find((p) => p.name === visible.name)
    const serverLevel: 'manufacturer_verified' | 'similar_model' | 'general_guidance' | 'unknown' =
      server?.evidenceLevel ?? 'unknown'
    const rendered = visible.evidenceLabelRendered
    const expectedRendered = serverLevel === 'unknown' ? null : LEVEL_TO_RENDERED[serverLevel]
    const agreement = expectedRendered !== null && expectedRendered !== rendered ? ' [MISMATCH]' : ''
    parts.push(`${visible.name} (${serverLevel}${agreement})`)
  }
  return parts.length === 0 ? '—' : parts.join('; ')
}

function summariseQuoteChecks(observations: readonly G10QuoteObservation[]): G10QuoteCheck {
  if (observations.length === 0) return 'n/a'
  if (observations.every((o) => o.result === 'pass')) return 'pass'
  if (observations.every((o) => o.result === 'n/a')) return 'n/a'
  return 'fail'
}

function firstManufacturerSourceTitle(response: G10PlanResponse): string {
  const verified = response.proposals.find((p) => p.source.url && p.evidenceLevel !== 'general_guidance')
  return verified?.source.title ?? '—'
}

function firstManufacturerSourceUrl(response: G10PlanResponse): string {
  const verified = response.proposals.find((p) => p.source.url && p.evidenceLevel !== 'general_guidance')
  return verified?.source.url ?? '—'
}

const LEVEL_TO_RENDERED: Record<G10PlanResponse['proposals'][number]['evidenceLevel'], G10VisibleTask['evidenceLabelRendered']> = {
  manufacturer_verified: 'Manufacturer verified',
  similar_model: 'Similar-model inference',
  general_guidance: 'General guidance',
}

function fmtTime(ms: number | null, case_: G10CaseName): string {
  if (ms === null) return 'n/a'
  const marker = !isFailureCase(case_) && ms > TIME_TARGET_MS ? ' [OVER 60s]' : ''
  return `${ms}${marker}`
}

// Build one G10 evidence row. The harness writes this to `<out-dir>/<case>-row.json`; the runner
// pastes it into the table in docs/live-gates.md.
export function buildG10Row(input: G10RowInput): G10Row {
  return {
    case: input.case,
    query: `${input.query.manufacturer}${input.query.model ? ` / ${input.query.model}` : ''}`,
    applianceId: input.applianceId ?? '—',
    chosenSourceTitle: firstManufacturerSourceTitle(input.response),
    chosenSourceUrl: firstManufacturerSourceUrl(input.response),
    extractedTasks: summariseTasks(input.visibleTasks, input.response),
    quoteCheck: summariseQuoteChecks(input.quoteObservations),
    fallback: input.case === 'calendar-write' ? 'n/a' : input.response.fallback,
    searchOutcome: input.case === 'calendar-write' ? 'n/a' : input.response.searchOutcome,
    timeToPlanMs: fmtTime(input.timeToPlanMs, input.case),
    calendarEventId: input.calendarEventId ?? 'n/a',
    defect: input.defect ?? '—',
  }
}

// True when the row's `timeToPlanMs` is over the magic-minute target. Failure cases are exempt;
// calendar-write is also exempt (its time-to-plan is the Approve round-trip, not the plan fetch).
export function isOverTimeTarget(row: G10Row): boolean {
  if (row.case === 'calendar-write') return false
  if (row.case === 'brave-fail' || row.case === 'minimax-fail') return false
  const m = /^(\d+)/.exec(row.timeToPlanMs)
  if (!m) return false
  return Number(m[1]) > TIME_TARGET_MS
}
