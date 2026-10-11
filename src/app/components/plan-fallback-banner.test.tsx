// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProposalMeta } from '@/domain/model'
import { PlanFallbackBanner, planFallbackReason } from './plan-fallback-banner'

// RF-351: each place the plan pipeline can stop has one reason and one sentence.
// A timeout before any candidate manual exists must not claim manuals were found.

const FOUND_MANUALS =
  'Keeply found manuals but could not read them right now. These are general dishwasher tasks, not a manufacturer recommendation.'
const SEARCH_TIMEOUT =
  'Keeply could not finish searching for a manual right now. Try again. These are general dishwasher tasks, not a manufacturer recommendation.'

function meta(
  searchOutcome: ProposalMeta['searchOutcome'],
  searchReason: string | null,
): ProposalMeta {
  return { fallback: 'general', searchOutcome, searchReason, searched: true }
}

const STOPS: readonly {
  stop: string
  meta: ProposalMeta | null
  reason: string
  wording: string
}[] = [
  {
    stop: 'budget ended before the search ran',
    meta: meta('timeout', 'timeout'),
    reason: 'search_timeout',
    wording: SEARCH_TIMEOUT,
  },
  {
    stop: 'manual search timed out before it returned a candidate',
    meta: meta('no_results', 'timeout'),
    reason: 'search_timeout',
    wording: SEARCH_TIMEOUT,
  },
  {
    stop: 'budget ended after manuals were found, before they could be read',
    meta: meta('timeout', null),
    reason: 'timeout',
    wording: FOUND_MANUALS,
  },
  {
    stop: 'manuals were found but reading was unavailable',
    meta: meta('extraction_unavailable', null),
    reason: 'extraction_unavailable',
    wording: FOUND_MANUALS,
  },
  {
    stop: 'a found manual could not be downloaded',
    meta: meta('fetch_failed', null),
    reason: 'fetch_failed',
    wording:
      'Could not download the manufacturer manual. Keeply found a manual link but could not open the document. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'a found manual could not be parsed',
    meta: meta('unreadable', null),
    reason: 'unreadable',
    wording:
      'Manufacturer manual was unreadable. Keeply found a manual but the document could not be parsed. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'a found manual had no text',
    meta: meta('no_text', null),
    reason: 'no_text',
    wording:
      'Manufacturer manual had no text. Keeply found a manual but the document did not contain readable text. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'no search key is configured',
    meta: meta('no_results', 'no_key'),
    reason: 'no_search_key',
    wording:
      'Keeply could not look for a manual for this model. No search key is configured on this device. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'manual search is disabled',
    meta: meta('unavailable', 'plan_search_disabled'),
    reason: 'plan_search_disabled',
    wording:
      'Manual search is not enabled on this device. Keeply did not search for a manufacturer manual. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'manual search was refused',
    meta: meta('unavailable', 'plan_search_refused'),
    reason: 'plan_search_refused',
    wording:
      'Keeply was not allowed to search. Keeply could not look for a manual at this time (no active session or no remaining scans). These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'the daily search quota is exhausted',
    meta: meta('quota_exhausted', 'quota_exhausted'),
    reason: 'quota_exhausted',
    wording:
      'Daily search quota reached. Keeply hit its daily search limit and did not fetch a manual. These are general guidance tasks. They are not a manufacturer recommendation. The limit resets at midnight UTC.',
  },
  {
    stop: 'search finished with no manual',
    meta: meta('no_results', 'no_results'),
    reason: 'no_results',
    wording:
      'No manufacturer manual found for this model. Keeply could not find a manual for this model. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'the search service could not be reached',
    meta: meta('unavailable', 'network_error'),
    reason: 'network_error',
    wording:
      'Could not reach the search service. Keeply could not reach its own search service. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
  {
    stop: 'an older plan has no proposal meta',
    meta: null,
    reason: 'no_proposal_meta',
    wording:
      'No manufacturer manual found for this model. Keeply could not find a manual for this model. These are general guidance tasks. They are not a manufacturer recommendation.',
  },
]

describe('plan fallback banner', () => {
  it.each(STOPS)('$stop → $reason', ({ meta: proposalMeta, reason, wording }) => {
    expect(planFallbackReason(proposalMeta)).toBe(reason)
    render(<PlanFallbackBanner meta={proposalMeta} />)
    const banner = screen.getByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', reason)
    expect(banner).toHaveTextContent(wording)
  })

  it('does not say manuals were found when the search itself timed out', () => {
    render(<PlanFallbackBanner meta={meta('no_results', 'timeout')} />)
    const banner = screen.getByTestId('plan-fallback-banner')
    expect(banner).not.toHaveTextContent(/found manuals/i)
    expect(banner).not.toHaveTextContent(/could not find a manual/i)
  })
})
