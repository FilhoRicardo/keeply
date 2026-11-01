// Owner-facing recovery when a non-dishwasher proposal produced no supported tasks.
// Categories stay conservative: an unknown or missing reason never invents a cause.

export type NoPlanCategory = 'nothing_suitable' | 'manual_information' | 'temporary' | 'invalid_request' | 'generic'

export type NoPlanSignal = {
  searchOutcome?: string | null
  searchReason?: string | null
}

export type NoPlanRecovery = {
  category: NoPlanCategory
  message: string
}

const COPY: Record<NoPlanCategory, string> = {
  nothing_suitable:
    'Keeply could not find suitable manufacturer guidance. Check the appliance type, manufacturer, and model.',
  manual_information: 'We couldn’t create a supported plan from this manual.',
  temporary: 'Keeply could not create a supported plan right now. Try again later.',
  invalid_request:
    'Keeply could not create a supported maintenance plan from these details. Check the appliance type, manufacturer, and model.',
  generic: 'Keeply could not create a supported maintenance plan. Check the details or try again later.',
}

// Same honesty as the dishwasher plan banner, without calling the tasks dishwasher tasks:
// this recovery is only shown when there is no plan to save.
const COULD_NOT_READ = new Set(['extraction_unavailable', 'timeout'])
const COULD_NOT_READ_COPY = 'Keeply found manuals but could not read them right now. Try again later.'
const SEARCH_TIMEOUT_COPY = 'Keeply could not finish searching for a manual right now. Try again.'

const MANUAL_INFORMATION = new Set(['fetch_failed', 'unreadable', 'no_text'])
const TEMPORARY = new Set([
  'quota_exhausted',
  'timeout',
  'extraction_unavailable',
  'network_error',
  'http_error',
  'rate_limited',
  'malformed_response',
])

function httpCategory(token: string): NoPlanCategory | null {
  const status = /^http_(\d+)$/.exec(token)
  if (!status) return null
  const code = Number(status[1])
  if (code === 408 || code === 429 || code >= 500) return 'temporary'
  if (code >= 400) return 'invalid_request'
  return null
}

function categoryFor(token: string | null | undefined): NoPlanCategory | null {
  if (!token) return null
  if (token === 'no_results' || token === 'search_empty') return 'nothing_suitable'
  if (token === 'manual_found_ai_no_tasks') return 'manual_information'
  if (token === 'search_error') return 'temporary'
  if (MANUAL_INFORMATION.has(token)) return 'manual_information'
  if (TEMPORARY.has(token)) return 'temporary'
  return httpCategory(token)
}

export function noPlanRecovery(signal: NoPlanSignal | null | undefined): NoPlanRecovery {
  // searchReason `timeout` means the search step stopped before any candidate manual was found.
  // A timeout after manuals were found leaves searchReason as something else (`no_plan` or null).
  if (signal?.searchReason === 'timeout') {
    return { category: 'temporary', message: SEARCH_TIMEOUT_COPY }
  }
  const fromOutcome = categoryFor(signal?.searchOutcome)
  const category = fromOutcome ?? categoryFor(signal?.searchReason) ?? 'generic'
  const token = fromOutcome ? signal?.searchOutcome : signal?.searchReason
  if (category === 'temporary' && typeof token === 'string' && COULD_NOT_READ.has(token)) {
    return { category, message: COULD_NOT_READ_COPY }
  }
  return { category, message: COPY[category] }
}
