import type { ProposalMeta } from '@/domain/model'

// Why the plan page is showing general-guidance tasks. Stable, machine-friendly, and matches the
// outcome that the live /api/plan proposer returned (KEE-43).
export type PlanFallbackReason =
  | 'no_search_key'
  | 'no_results'
  | 'search_empty'
  | 'search_error'
  | 'manual_found_ai_no_tasks'
  | 'fetch_failed'
  | 'extraction_unavailable'
  | 'unreadable'
  | 'no_text'
  | 'timeout'
  | 'search_timeout'
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
  // `timeout` with searchReason `timeout` is the search step itself: no candidate manual was
  // found. A later timeout (download or reading) keeps searchReason null and stays `timeout`.
  if (meta.searchOutcome === 'timeout') return meta.searchReason === 'timeout' ? 'search_timeout' : 'timeout'
  if (meta.searchOutcome === 'fetch_failed') return 'fetch_failed'
  if (meta.searchOutcome === 'extraction_unavailable') return 'extraction_unavailable'
  if (meta.searchOutcome === 'unreadable') return 'unreadable'
  if (meta.searchOutcome === 'no_text') return 'no_text'
  if (meta.searchReason === 'no_key') return 'no_search_key'
  if (meta.searchReason === 'plan_search_disabled') return 'plan_search_disabled'
  if (meta.searchReason === 'plan_search_refused') return 'plan_search_refused'
  if (meta.searchReason === 'network_error') return 'network_error'
  if (meta.searchReason === 'timeout') return 'search_timeout'
  if (meta.searchOutcome === 'search_empty') return 'search_empty'
  if (meta.searchOutcome === 'search_error') return 'search_error'
  if (meta.searchOutcome === 'manual_found_ai_no_tasks') return 'manual_found_ai_no_tasks'
  if (meta.searchOutcome === 'no_results') return 'no_results'
  return 'no_search_key'
}

// This banner only appears when every task is the dishwasher general-guidance list. Other
// appliances never get that list; they stay on the entry screen with no-plan recovery.
const REASON_COPY: Record<PlanFallbackReason, { eyebrow: string; title: string; body: string }> = {
  no_search_key: {
    eyebrow: 'General guidance',
    title: 'Keeply could not look for a manual for this model',
    body:
      'No search key is configured on this device. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  plan_search_disabled: {
    eyebrow: 'General guidance',
    title: 'Manual search is not enabled on this device',
    body:
      'Keeply did not search for a manufacturer manual. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  plan_search_refused: {
    eyebrow: 'General guidance',
    title: 'Keeply was not allowed to search',
    body:
      'Keeply could not look for a manual at this time (no active session or no remaining scans). These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  quota_exhausted: {
    eyebrow: 'General guidance',
    title: 'Daily search quota reached',
    body:
      'Keeply hit its daily search limit and did not fetch a manual. These are general guidance tasks. They are not a manufacturer recommendation. The limit resets at midnight UTC.',
  },
  no_results: {
    eyebrow: 'General guidance',
    title: 'No manufacturer manual matched this model',
    body:
      'Keeply found manuals but none named this model on the cover. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  search_empty: {
    eyebrow: 'General guidance',
    title: 'No manufacturer manual found for this model',
    body:
      'Keeply search returned no suitable manual links. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  search_error: {
    eyebrow: 'General guidance',
    title: 'Keeply could not complete the manual search',
    body:
      'The search service failed or was unavailable. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  manual_found_ai_no_tasks: {
    eyebrow: 'General guidance',
    title: 'We found the manual but could not extract tasks from it yet',
    body:
      'Keeply matched a manufacturer manual for this model but could not turn it into verified tasks. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  fetch_failed: {
    eyebrow: 'General guidance',
    title: 'Could not download the manufacturer manual',
    body:
      'Keeply found a manual link but could not open the document. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  extraction_unavailable: {
    eyebrow: 'General guidance',
    title: 'Keeply found manuals but could not read them right now',
    body: 'These are general dishwasher tasks, not a manufacturer recommendation.',
  },
  unreadable: {
    eyebrow: 'General guidance',
    title: 'Manufacturer manual was unreadable',
    body:
      'Keeply found a manual but the document could not be parsed. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  no_text: {
    eyebrow: 'General guidance',
    title: 'Manufacturer manual had no text',
    body:
      'Keeply found a manual but the document did not contain readable text. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  timeout: {
    eyebrow: 'General guidance',
    title: 'Keeply found manuals but could not read them right now',
    body: 'These are general dishwasher tasks, not a manufacturer recommendation.',
  },
  search_timeout: {
    eyebrow: 'General guidance',
    title: 'Keeply could not finish searching for a manual right now',
    body: 'Try again. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  network_error: {
    eyebrow: 'General guidance',
    title: 'Could not reach the search service',
    body:
      'Keeply could not reach its own search service. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  // Older rows have no stored outcome. Say only what the tasks are. Never claim the search
  // found nothing: that reason belongs to a saved no_results outcome.
  no_proposal_meta: {
    eyebrow: 'General guidance',
    title: 'Keeply has no record of how this plan was built',
    body: 'These are general guidance tasks. They are not a manufacturer recommendation.',
  },
}

// Renders the honest "this is not a manufacturer recommendation" banner on the plan page when
// every task is general-guidance. Shows a stable data-fallback-reason so e2e / component tests
// can pin the message without depending on the exact wording.
export function PlanFallbackBanner({ meta }: { meta: ProposalMeta | null }) {
  const reason = planFallbackReason(meta)
  const copy = REASON_COPY[reason]
  const manualUrl = meta?.manualUrl?.trim()
  return (
    <section className="plan-fallback" data-testid="plan-fallback-banner" data-fallback-reason={reason}>
      <p className="plan-fallback-eyebrow">{copy.eyebrow}</p>
      <p>
        <strong>{copy.title}.</strong> {copy.body}
      </p>
      {reason === 'manual_found_ai_no_tasks' && manualUrl ? (
        <p>
          <a href={manualUrl} rel="noopener noreferrer" target="_blank">
            Open the manufacturer manual
          </a>
        </p>
      ) : null}
    </section>
  )
}
