import { describe, expect, it } from 'vitest'
import { noRecognizer } from '@/domain/identification'
import { CANDIDATES, manualProvider, selectProvider, type AiCandidate } from './provider'

const fake = (kind: AiCandidate['kind'], available: boolean | 'throws'): AiCandidate => ({
  kind,
  available: () => {
    if (available === 'throws') throw new Error('misconfigured')
    return available
  },
  create: () => ({ kind, recogniser: noRecognizer }),
})

describe('selectProvider', () => {
  it('is Manual in v0.1, whatever the environment says', () => {
    expect(selectProvider({ env: { OPENAI_API_KEY: 'sk-test' }, authorisation: { kind: 'chatgpt', available: true } }).kind).toBe('manual')
  })

  it('keeps the documented preference order with Manual last', () => {
    expect(CANDIDATES.map((c) => c.kind)).toEqual(['chatgpt_authorized', 'byo_api_key', 'keeply_hosted', 'manual'])
  })

  it('picks the first available provider', () => {
    const order = [fake('chatgpt_authorized', false), fake('byo_api_key', true), fake('manual', true)]
    expect(selectProvider({ env: {} }, order).kind).toBe('byo_api_key')
  })

  it('falls back past a provider that fails, and to Manual when none is available', () => {
    expect(selectProvider({ env: {} }, [fake('chatgpt_authorized', 'throws'), fake('manual', true)]).kind).toBe('manual')
    expect(selectProvider({ env: {} }, [fake('byo_api_key', false)])).toBe(manualProvider)
  })
})
