import { describe, expect, it } from 'vitest'
import {
  buildG10Row as buildTs,
  isOverTimeTarget as isOverTs,
  G10_CASES,
  type G10RowInput,
} from './live-plan-row'
// Import the .mjs mirror. Vitest's node environment supports dynamic import for ESM.
// The shape is asserted by the test below; a TS error on this line is the cross-check itself
// telling us the .mjs is out of sync.
// @ts-expect-error -- the .mjs has no .d.ts; this cross-check test is what pins the contract.
const { buildG10Row: buildMjs, isOverTimeTarget: isOverMjs } = await import('../../../scripts/g10-row.mjs')

// KEE-44: the G10 evidence row shape is defined once in TS (src/app/lib/live-plan-row.ts) and
// mirrored in scripts/g10-row.mjs for the harness. If the two diverge, the harness writes rows
// the G10 table cannot render. This test loads both and asserts they agree on a battery of
// fixed inputs, including the seven case names G10 requires.

const baseInput: Omit<G10RowInput, 'case'> = {
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

describe('G10 row mirror (TS <-> scripts/g10-row.mjs)', () => {
  it('lists the seven G10 case names', () => {
    expect(G10_CASES).toEqual([
      'exact-manual',
      'similar-only',
      'no-manual',
      'scanned-pdf',
      'brave-fail',
      'openrouter-fail',
      'calendar-write',
    ])
  })

  for (const caseName of G10_CASES) {
    it(`agrees for case ${caseName}`, () => {
      const ts = buildTs({ ...baseInput, case: caseName })
      // The .mjs accepts the same input shape; spread to drop the strict-case literal type.
      const mjs = buildMjs({ ...baseInput, case: caseName })
      expect(mjs).toEqual(ts)
      expect(isOverMjs(ts)).toBe(isOverTs(ts))
    })
  }

  it('agrees on a row that is over the magic-minute target', () => {
    const ts = buildTs({ ...baseInput, case: 'exact-manual', timeToPlanMs: 90_000 })
    const mjs = buildMjs({ ...baseInput, case: 'exact-manual', timeToPlanMs: 90_000 })
    expect(mjs).toEqual(ts)
    expect(isOverMjs(ts)).toBe(true)
    expect(isOverTs(ts)).toBe(true)
  })

  it('agrees on a calendar-write row with a calendar event id', () => {
    const ts = buildTs({ ...baseInput, case: 'calendar-write', calendarEventId: 'kp1234abcd' })
    const mjs = buildMjs({ ...baseInput, case: 'calendar-write', calendarEventId: 'kp1234abcd' })
    expect(mjs).toEqual(ts)
  })
})
