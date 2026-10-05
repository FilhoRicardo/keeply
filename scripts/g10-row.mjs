// KEE-44: the G10 evidence row builder used by scripts/live-plan-check.mjs. This file is a
// faithful mirror of the function in src/app/lib/live-plan-row.ts. The TS function is the source
// of truth and is unit-tested; the test src/app/lib/live-plan-row.cross-check.test.mjs imports
// BOTH this file and the TS function and asserts the two agree on a fixed input, so a drift
// here is caught by pnpm test.
//
// The two implementations stay in lockstep. If you change the row shape, change both, and the
// cross-check test will fail until they agree.

export const G10_CASES = [
  'exact-manual',
  'similar-only',
  'no-manual',
  'scanned-pdf',
  'brave-fail',
  'minimax-fail',
  'calendar-write',
]

const TIME_TARGET_MS = 60_000

const LEVEL_TO_RENDERED = {
  manufacturer_verified: 'Manufacturer verified',
  similar_model: 'Similar-model inference',
  general_guidance: 'General guidance',
}

function isFailureCase(caseName) {
  return caseName === 'brave-fail' || caseName === 'minimax-fail'
}

function summariseTasks(visibleTasks, response) {
  const parts = []
  for (const visible of visibleTasks) {
    const server = (response.proposals ?? []).find((p) => p.name === visible.name)
    const serverLevel = server?.evidenceLevel ?? 'unknown'
    const rendered = visible.evidenceLabelRendered
    const agreement = LEVEL_TO_RENDERED[serverLevel] === rendered ? '' : ' [MISMATCH]'
    parts.push(`${visible.name} (${serverLevel}${agreement})`)
  }
  return parts.length === 0 ? '—' : parts.join('; ')
}

function summariseQuoteChecks(observations) {
  if (!observations || observations.length === 0) return 'n/a'
  if (observations.every((o) => o.result === 'pass')) return 'pass'
  if (observations.every((o) => o.result === 'n/a')) return 'n/a'
  return 'fail'
}

function firstManufacturerSourceTitle(response) {
  const verified = (response.proposals ?? []).find(
    (p) => p.source && p.source.url && p.evidenceLevel !== 'general_guidance',
  )
  return verified?.source?.title ?? '—'
}

function firstManufacturerSourceUrl(response) {
  const verified = (response.proposals ?? []).find(
    (p) => p.source && p.source.url && p.evidenceLevel !== 'general_guidance',
  )
  return verified?.source?.url ?? '—'
}

function fmtTime(ms, caseName) {
  if (ms === null || ms === undefined) return 'n/a'
  const marker = !isFailureCase(caseName) && ms > TIME_TARGET_MS ? ' [OVER 60s]' : ''
  return `${ms}${marker}`
}

export function buildG10Row(input) {
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

export function isOverTimeTarget(row) {
  if (row.case === 'calendar-write') return false
  if (row.case === 'brave-fail' || row.case === 'minimax-fail') return false
  const m = /^(\d+)/.exec(String(row.timeToPlanMs))
  if (!m) return false
  return Number(m[1]) > TIME_TARGET_MS
}
