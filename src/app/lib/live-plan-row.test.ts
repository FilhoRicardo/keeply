import { describe, expect, it } from 'vitest'
import { buildG10Row, isOverTimeTarget, type G10RowInput } from './live-plan-row'

// KEE-44: the G10 evidence row contract. The harness writes these rows; the runner pastes them
// into docs/live-gates.md. The test pins the field names, the magic-minute target, the rendered
// vs. server evidence-level agreement check, and the failure-case time exemption.

const ELECTROLUX_INPUT: G10RowInput = {
  case: 'exact-manual',
  query: { manufacturer: 'Electrolux', model: 'KEQB7300L' },
  applianceId: 'a-1',
  response: {
    proposals: [
      {
        name: 'Clean the filter',
        evidenceLevel: 'manufacturer_verified',
        source: { title: 'Electrolux KEQB7300L user manual', url: 'https://www.electrolux.com/manual.pdf' },
      },
      {
        name: 'Check the spray arms',
        evidenceLevel: 'manufacturer_verified',
        source: { title: 'Electrolux KEQB7300L user manual', url: 'https://www.electrolux.com/manual.pdf' },
      },
    ],
    fallback: 'exact',
    searchOutcome: 'ok',
  },
  visibleTasks: [
    { name: 'Clean the filter', evidenceLabelRendered: 'Manufacturer verified', quoteText: 'Clean the filter once a month.' },
    { name: 'Check the spray arms', evidenceLabelRendered: 'Manufacturer verified', quoteText: 'Inspect the spray arms monthly.' },
  ],
  quoteObservations: [
    { taskName: 'Clean the filter', result: 'pass', quote: 'Clean the filter once a month.' },
    { taskName: 'Check the spray arms', result: 'pass', quote: 'Inspect the spray arms monthly.' },
  ],
  timeToPlanMs: 42_000,
  calendarEventId: null,
  defect: null,
}

describe('buildG10Row', () => {
  it('records the exact-manual case with a passing quote check and under-target time', () => {
    const row = buildG10Row(ELECTROLUX_INPUT)
    expect(row.case).toBe('exact-manual')
    expect(row.query).toBe('Electrolux / KEQB7300L')
    expect(row.chosenSourceTitle).toBe('Electrolux KEQB7300L user manual')
    expect(row.chosenSourceUrl).toBe('https://www.electrolux.com/manual.pdf')
    expect(row.quoteCheck).toBe('pass')
    expect(row.fallback).toBe('exact')
    expect(row.searchOutcome).toBe('ok')
    expect(row.timeToPlanMs).toBe('42000')
    expect(row.calendarEventId).toBe('n/a')
    expect(row.defect).toBe('—')
    expect(row.extractedTasks).toContain('Clean the filter (manufacturer_verified)')
    expect(row.extractedTasks).toContain('Check the spray arms (manufacturer_verified)')
    expect(isOverTimeTarget(row)).toBe(false)
  })

  it('marks the row [MISMATCH] when the server evidence level disagrees with the rendered label', () => {
    const row = buildG10Row({
      ...ELECTROLUX_INPUT,
      response: {
        ...ELECTROLUX_INPUT.response,
        proposals: [
          {
            name: 'Clean the filter',
            evidenceLevel: 'similar_model',
            source: { title: 'Electrolux family manual', url: 'https://www.electrolux.com/family.pdf' },
          },
        ],
      },
      visibleTasks: [
        // The page renders Manufacturer verified, but the API said similar_model. This must
        // be visible in the row so the G10 reviewer notices (non-negotiable #2).
        { name: 'Clean the filter', evidenceLabelRendered: 'Manufacturer verified', quoteText: null },
      ],
    })
    expect(row.extractedTasks).toContain('[MISMATCH]')
    expect(row.fallback).toBe('exact') // unchanged: the route still says exact
  })

  it('reports quote_check fail when any Manufacturer verified quote is not found by code', () => {
    const row = buildG10Row({
      ...ELECTROLUX_INPUT,
      quoteObservations: [
        { taskName: 'Clean the filter', result: 'pass', quote: 'Clean the filter once a month.' },
        { taskName: 'Check the spray arms', result: 'fail', quote: 'Inspect the spray arms monthly.' },
      ],
    })
    expect(row.quoteCheck).toBe('fail')
  })

  it('reports n/a when there are no Manufacturer verified tasks (general guidance fallback)', () => {
    const row = buildG10Row({
      ...ELECTROLUX_INPUT,
      case: 'no-manual',
      response: {
        proposals: [
          { name: 'Wipe the door seal', evidenceLevel: 'general_guidance', source: { title: 'Keeply general dishwasher maintenance guidance', url: null } },
          { name: 'Run hot water before a cycle', evidenceLevel: 'general_guidance', source: { title: 'Keeply general dishwasher maintenance guidance', url: null } },
          { name: 'Clean the filter', evidenceLevel: 'general_guidance', source: { title: 'Keeply general dishwasher maintenance guidance', url: null } },
        ],
        fallback: 'general',
        searchOutcome: 'no_results',
      },
      visibleTasks: [
        { name: 'Wipe the door seal', evidenceLabelRendered: 'General guidance', quoteText: null },
        { name: 'Run hot water before a cycle', evidenceLabelRendered: 'General guidance', quoteText: null },
        { name: 'Clean the filter', evidenceLabelRendered: 'General guidance', quoteText: null },
      ],
      quoteObservations: [],
      timeToPlanMs: 8_000,
    })
    expect(row.quoteCheck).toBe('n/a')
    expect(row.fallback).toBe('general')
    expect(row.searchOutcome).toBe('no_results')
    expect(row.chosenSourceTitle).toBe('—')
    expect(row.chosenSourceUrl).toBe('—')
  })

  it('marks the row [OVER 60s] when the magic-minute target is exceeded (non-failure cases)', () => {
    const row = buildG10Row({ ...ELECTROLUX_INPUT, timeToPlanMs: 90_000 })
    expect(row.timeToPlanMs).toBe('90000 [OVER 60s]')
    expect(isOverTimeTarget(row)).toBe(true)
  })

  it('exempts brave-fail and minimax-fail from the time target (pass criteria)', () => {
    const row = buildG10Row({ ...ELECTROLUX_INPUT, case: 'brave-fail', timeToPlanMs: 4_000 })
    expect(row.timeToPlanMs).toBe('4000')
    expect(isOverTimeTarget(row)).toBe(false)

    const row2 = buildG10Row({ ...ELECTROLUX_INPUT, case: 'minimax-fail', timeToPlanMs: 90_000 })
    expect(row2.timeToPlanMs).toBe('90000')
    expect(isOverTimeTarget(row2)).toBe(false)
  })

  it('records the calendar-write case with an event id and n/a for fallback / outcome', () => {
    const row = buildG10Row({
      ...ELECTROLUX_INPUT,
      case: 'calendar-write',
      calendarEventId: 'kp1234abcd',
    })
    expect(row.fallback).toBe('n/a')
    expect(row.searchOutcome).toBe('n/a')
    expect(row.calendarEventId).toBe('kp1234abcd')
    expect(isOverTimeTarget(row)).toBe(false)
  })

  it('records the defect when the runner flagged one', () => {
    const row = buildG10Row({ ...ELECTROLUX_INPUT, defect: 'KEE-46' })
    expect(row.defect).toBe('KEE-46')
  })
})
