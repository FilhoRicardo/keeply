import type { SearchReason } from '@/search/brave'
import type { ProposalMeta } from '@/domain/model'
import type { SearchOutcome } from './plan-orchestration'

// Maps Brave empty-search reasons to honest plan outcomes. Quota stays on its own outcome.
export function emptySearchToPlanOutcome(reason: SearchReason): {
  searchOutcome: SearchOutcome
  searchReason: string
} {
  if (reason === 'quota_exhausted') {
    return { searchOutcome: 'quota_exhausted', searchReason: 'quota_exhausted' }
  }
  if (reason === 'no_results') {
    return { searchOutcome: 'search_empty', searchReason: 'no_results' }
  }
  return { searchOutcome: 'search_error', searchReason: reason }
}

const SEARCH_ERROR_REASONS = new Set<string>([
  'rate_limited',
  'timeout',
  'network_error',
  'http_error',
  'malformed_response',
])

export function isSearchErrorReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  if (SEARCH_ERROR_REASONS.has(reason)) return true
  return /^http_\d{3}$/.test(reason)
}

// proposal_meta in Postgres still uses the legacy outcome enum (no migration). Encode new outcomes
// in searchReason on write; expand them again on read.
export function proposalMetaForStorage(meta: ProposalMeta): ProposalMeta {
  const { manualUrl: _manualUrl, ...rest } = meta
  void _manualUrl
  const base = rest as ProposalMeta
  if (base.searchOutcome === 'search_empty') {
    return { ...base, searchOutcome: 'no_results', searchReason: 'search_empty' }
  }
  if (base.searchOutcome === 'search_error') {
    return { ...base, searchOutcome: 'no_results', searchReason: base.searchReason ?? 'http_error' }
  }
  if (base.searchOutcome === 'manual_found_ai_no_tasks') {
    return { ...base, searchOutcome: 'no_results', searchReason: 'manual_found_ai_no_tasks' }
  }
  return base
}

export function proposalMetaFromStorage(meta: ProposalMeta): ProposalMeta {
  if (meta.searchOutcome === 'no_results' && meta.searchReason === 'no_results') {
    return { ...meta, searchOutcome: 'search_empty' }
  }
  if (meta.searchReason === 'search_empty') {
    return { ...meta, searchOutcome: 'search_empty', searchReason: 'no_results' }
  }
  if (meta.searchReason === 'manual_found_ai_no_tasks') {
    return { ...meta, searchOutcome: 'manual_found_ai_no_tasks', searchReason: null }
  }
  if (meta.searchOutcome === 'no_results' && isSearchErrorReason(meta.searchReason)) {
    return { ...meta, searchOutcome: 'search_error' }
  }
  return meta
}
