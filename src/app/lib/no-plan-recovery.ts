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
  if (token === 'no_results') return 'nothing_suitable'
  if (MANUAL_INFORMATION.has(token)) return 'manual_information'
  if (TEMPORARY.has(token)) return 'temporary'
  return httpCategory(token)
}

export function noPlanRecovery(signal: NoPlanSignal | null | undefined): NoPlanRecovery {
  const category = categoryFor(signal?.searchOutcome) ?? categoryFor(signal?.searchReason) ?? 'generic'
  return { category, message: COPY[category] }
}
