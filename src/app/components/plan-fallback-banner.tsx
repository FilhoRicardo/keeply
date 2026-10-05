import type { ProposalMeta } from '@/domain/model'

// Why the plan page is showing general-guidance tasks. Stable, machine-friendly, and matches the
// outcome that the live /api/plan proposer returned (KEE-43).
export type PlanFallbackReason =
  | 'no_search_key'
  | 'no_results'
  | 'fetch_failed'
  | 'extraction_unavailable'
  | 'unreadable'
  | 'no_text'
  | 'timeout'
  | 'quota_exhausted'
  | 'plan_search_disabled'
  | 'plan_search_refused'
  | 'network_error'
  | 'no_proposal_meta'

// Maps a ProposalMeta (or its absence) to a stable, UI-friendly reason. Kept in one place so the
// e2e / component tests can pin the same data-fallback-reason the banner shows.
export function planFallbackReason(meta: ProposalMeta | null): PlanFallbackReason {
  if (!meta) return 'no_proposal_meta'
  if (meta.searchOutcome === 'quota_exhausted') return 'quota_exhausted'
  if (meta.searchOutcome === 'timeout') return 'timeout'
  if (meta.searchOutcome === 'fetch_failed') return 'fetch_failed'
  if (meta.searchOutcome === 'extraction_unavailable') return 'extraction_unavailable'
  if (meta.searchOutcome === 'unreadable') return 'unreadable'
  if (meta.searchOutcome === 'no_text') return 'no_text'
  if (meta.searchReason === 'no_key') return 'no_search_key'
  if (meta.searchReason === 'plan_search_disabled') return 'plan_search_disabled'
  if (meta.searchReason === 'plan_search_refused') return 'plan_search_refused'
  if (meta.searchReason === 'network_error') return 'network_error'
  if (meta.searchReason === 'timeout') return 'timeout'
  if (meta.searchOutcome === 'no_results') return 'no_results'
  return 'no_search_key'
}

const REASON_COPY: Record<PlanFallbackReason, { eyebrow: string; title: string; body: string }> = {
  no_search_key: {
    eyebrow: 'General guidance',
    title: 'Keeply could not look for a manual for this model',
    body:
      'No search key is configured on this device. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  plan_search_disabled: {
    eyebrow: 'General guidance',
    title: 'Manual search is not enabled on this device',
    body:
      'Keeply did not search for a manufacturer manual. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  plan_search_refused: {
    eyebrow: 'General guidance',
    title: 'Keeply was not allowed to search',
    body:
      'Keeply could not look for a manual at this time (no active session or no remaining scans). These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  quota_exhausted: {
    eyebrow: 'General guidance',
    title: 'Daily search quota reached',
    body:
      'Keeply hit its daily search limit and did not fetch a manual. These are general dishwasher tasks. They are not a manufacturer recommendation. The limit resets at midnight UTC.',
  },
  no_results: {
    eyebrow: 'General guidance',
    title: 'No manufacturer manual found for this model',
    body:
      'Keeply could not find a manual for this model. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  fetch_failed: {
    eyebrow: 'General guidance',
    title: 'Could not download the manufacturer manual',
    body:
      'Keeply found a manual link but could not open the document. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  extraction_unavailable: {
    eyebrow: 'General guidance',
    title: 'Could not read the manufacturer manual',
    body:
      'Keeply found a manual but the AI service is not available right now. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  unreadable: {
    eyebrow: 'General guidance',
    title: 'Manufacturer manual was unreadable',
    body:
      'Keeply found a manual but the document could not be parsed. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  no_text: {
    eyebrow: 'General guidance',
    title: 'Manufacturer manual had no text',
    body:
      'Keeply found a manual but the document did not contain readable text. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  timeout: {
    eyebrow: 'General guidance',
    title: 'Search took too long',
    body:
      'Keeply did not finish searching in time. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  network_error: {
    eyebrow: 'General guidance',
    title: 'Could not reach the search service',
    body:
      'Keeply could not reach its own search service. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
  no_proposal_meta: {
    eyebrow: 'General guidance',
    title: 'No manufacturer manual found for this model',
    body:
      'Keeply could not find a manual for this model. These are general dishwasher tasks. They are not a manufacturer recommendation.',
  },
}

// Renders the honest "this is not a manufacturer recommendation" banner on the plan page when
// every task is general-guidance. Shows a stable data-fallback-reason so e2e / component tests
// can pin the message without depending on the exact wording.
export function PlanFallbackBanner({ meta }: { meta: ProposalMeta | null }) {
  const reason = planFallbackReason(meta)
  const copy = REASON_COPY[reason]
  return (
    <section className="plan-fallback" data-testid="plan-fallback-banner" data-fallback-reason={reason}>
      <p className="plan-fallback-eyebrow">{copy.eyebrow}</p>
      <p>
        <strong>{copy.title}.</strong> {copy.body}
      </p>
    </section>
  )
}
