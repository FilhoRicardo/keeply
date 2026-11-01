// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { ProposalMeta } from '@/domain/model'
import { PlanFallbackBanner, planFallbackReason, type PlanFallbackReason } from './plan-fallback-banner'

// Each place the plan pipeline can stop, the meta the banner receives, and the reason plus
// wording the owner should see. Search-step timeouts must not claim that manuals were found.

function meta(
  searchOutcome: ProposalMeta['searchOutcome'],
  searchReason: string | null,
  searched = true,
): ProposalMeta {
  return { fallback: 'general', searchOutcome, searchReason, searched }
}

const STOPS: ReadonlyArray<{
  stop: string
  meta: ProposalMeta | null
  reason: PlanFallbackReason
  wording: RegExp
  absent?: RegExp
}> = [
  {
    stop: 'budget expired before the search started',
    meta: meta('timeout', 'timeout'),
    reason: 'search_timeout',
    wording: /Keeply could not finish searching for a manual right now\. Try again\./,
    absent: /found manuals/i,
  },
  {
    stop: 'budget expired after the quota check and before search',
    meta: meta('timeout', 'timeout'),
    reason: 'search_timeout',
    wording: /Keeply could not finish searching for a manual right now\. Try again\./,
    absent: /found manuals/i,
  },
  {
    stop: 'search timed out before any candidate manual was found',
    meta: meta('no_results', 'timeout'),
    reason: 'search_timeout',
    wording: /Keeply could not finish searching for a manual right now\. Try again\./,
    absent: /found manuals/i,
  },
  {
    stop: 'search returned no manuals',
    meta: meta('search_empty', 'no_results'),
    reason: 'search_empty',
    wording: /No manufacturer manual found for this model\./,
  },
  {
    stop: 'search was rate limited',
    meta: meta('search_error', 'rate_limited'),
    reason: 'search_error',
    wording: /Keeply could not complete the manual search\./,
  },
  {
    stop: 'manual matched but AI produced no tasks',
    meta: { ...meta('manual_found_ai_no_tasks', null), manualUrl: 'https://example.com/manual.pdf' },
    reason: 'manual_found_ai_no_tasks',
    wording: /We found the manual but could not extract tasks from it yet\./,
  },
  {
    stop: 'no search key is configured',
    meta: meta('no_results', 'no_key'),
    reason: 'no_search_key',
    wording: /Keeply could not look for a manual for this model\./,
  },
  {
    stop: 'daily search quota was exhausted',
    meta: meta('quota_exhausted', 'quota_exhausted'),
    reason: 'quota_exhausted',
    wording: /Daily search quota reached\./,
  },
  {
    stop: 'budget expired after candidate manuals were found',
    meta: meta('timeout', null),
    reason: 'timeout',
    wording: /Keeply found manuals but could not read them right now\./,
  },
  {
    stop: 'a found manual could not be downloaded in time',
    meta: meta('timeout', null),
    reason: 'timeout',
    wording: /Keeply found manuals but could not read them right now\./,
  },
  {
    stop: 'a found manual link could not be opened',
    meta: meta('fetch_failed', null),
    reason: 'fetch_failed',
    wording: /Could not download the manufacturer manual\./,
  },
  {
    stop: 'a found manual could not be read',
    meta: meta('extraction_unavailable', null),
    reason: 'extraction_unavailable',
    wording: /Keeply found manuals but could not read them right now\./,
  },
  {
    stop: 'a found manual was unreadable',
    meta: meta('unreadable', null),
    reason: 'unreadable',
    wording: /Manufacturer manual was unreadable\./,
  },
  {
    stop: 'a found manual had no text',
    meta: meta('no_text', null),
    reason: 'no_text',
    wording: /Manufacturer manual had no text\./,
  },
  {
    stop: 'manual search is not enabled',
    meta: meta('unavailable', 'plan_search_disabled', false),
    reason: 'plan_search_disabled',
    wording: /Manual search is not enabled on this device\./,
  },
  {
    stop: 'the search was refused',
    meta: meta('unavailable', 'plan_search_refused', false),
    reason: 'plan_search_refused',
    wording: /Keeply was not allowed to search\./,
  },
  {
    stop: 'the plan service could not be reached',
    meta: meta('unavailable', 'network_error', false),
    reason: 'network_error',
    wording: /Could not reach the search service\./,
  },
  {
    stop: 'the plan API timed out (504)',
    meta: meta('unavailable', 'http_504', false),
    reason: 'plan_time_budget',
    wording: /Keeply ran out of time looking for the manual/,
    absent: /No search key is configured/,
  },
  {
    stop: 'the plan API returned an unexpected HTTP error',
    meta: meta('unavailable', 'http_500', false),
    reason: 'service_error',
    wording: /Keeply could not finish building this plan/,
    absent: /No search key is configured/,
  },
  {
    stop: 'proposal meta is incomplete',
    meta: meta('unavailable', null, false),
    reason: 'service_error',
    wording: /Keeply could not finish building this plan/,
    absent: /No search key is configured/,
  },
  {
    stop: 'an older plan has no proposal record',
    meta: null,
    reason: 'no_proposal_meta',
    wording: /Keeply has no record of how this plan was built/,
    absent: /No manufacturer manual found/,
  },
]

describe('plan fallback banner', () => {
  it.each(STOPS)('$stop → $reason', ({ meta: proposalMeta, reason, wording, absent }) => {
    expect(planFallbackReason(proposalMeta)).toBe(reason)
    render(<PlanFallbackBanner meta={proposalMeta} />)
    const banner = screen.getByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', reason)
    expect(banner).toHaveTextContent(wording)
    expect(banner).toHaveTextContent(/not a manufacturer recommendation/i)
    if (absent) expect(banner).not.toHaveTextContent(absent)
  })
})
