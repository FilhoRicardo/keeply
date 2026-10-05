import { describe, expect, it, vi } from 'vitest'
import { CANDIDATES, manualProvider, selectProvider, type AiCandidate } from './provider'

const fake = (kind: AiCandidate['kind'], available: boolean | 'throws'): AiCandidate => ({
  kind,
  available: () => {
    if (available === 'throws') throw new Error('misconfigured')
    return available
  },
  create: () => ({ kind, identifyAppliance: async () => null, extractTasks: async () => 'unavailable' }),
})

describe('selectProvider', () => {
  it('keeps the documented order with Manual last', () => {
    expect(CANDIDATES.map((c) => c.kind)).toEqual([
      'chatgpt_authorized',
      'minimax',
      'openai_api',
      'anthropic_api',
      'keeply_hosted',
      'manual',
    ])
  })

  it('is Manual with no AI configured, whatever the Keeply login', () => {
    expect(selectProvider({ env: {}, authorisation: null }).kind).toBe('manual')
  })

  it('uses MiniMax when a vision model and key are configured on the server', () => {
    expect(selectProvider({ env: { MINIMAX_API_KEY: 'k' } }).kind).toBe('minimax')
    expect(selectProvider({ env: { MINIMAX_API_KEY: 'k', MINIMAX_MODEL: 'MiniMax-M3.1-Flash-Preview' } }).kind).toBe('minimax')
  })

  it('refuses a MiniMax model without image input and falls back to Manual', () => {
    expect(selectProvider({ env: { MINIMAX_API_KEY: 'k', MINIMAX_MODEL: 'MiniMax-M2.7' } }).kind).toBe('manual')
  })

  it('ignores keys for providers that are not built yet', () => {
    expect(selectProvider({ env: { OPENAI_API_KEY: 'x', ANTHROPIC_API_KEY: 'y' } }).kind).toBe('manual')
  })

  it('picks the first available and falls past a failing provider', () => {
    expect(selectProvider({ env: {} }, [fake('chatgpt_authorized', 'throws'), fake('minimax', true), fake('manual', true)]).kind).toBe('minimax')
    expect(selectProvider({ env: {} }, [fake('openai_api', false)])).toBe(manualProvider)
  })

  it('wires the MiniMax adapter to the injected fetch', async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: '{"applianceType":"dishwasher","manufacturer":"Bosch","model":"SMS6ZCI49E","serialNumber":null,"confidence":0.9}' } }] }),
    )
    const provider = selectProvider({ env: { MINIMAX_API_KEY: 'k' }, fetch: fetchMock as unknown as typeof fetch })
    expect(await provider.identifyAppliance({ bytes: new Uint8Array([1]), mimeType: 'image/jpeg' })).toMatchObject({ model: 'SMS6ZCI49E' })
  })

  it('wires the MiniMax adapter to extractTasks through the same provider', async () => {
    const body = { candidates: [{ task: 'Clean the filter', instructions: 'Rinse it.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Clean the filter every month.' }] }
    const fetchMock = vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(body) } }] }))
    const provider = selectProvider({ env: { MINIMAX_API_KEY: 'k' }, fetch: fetchMock as unknown as typeof fetch })
    const result = await provider.extractTasks({ model: 'MiniMax-M3', pages: [{ page: 1, text: 'Page one says: Clean the filter every month.' }] })
    expect(result).toEqual([
      { task: 'Clean the filter', instructions: 'Rinse it.', interval: { count: 1, unit: 'month' }, page: 1, quote: 'Clean the filter every month.' },
    ])
  })

  it('returns "unavailable" for the Manual provider and any provider that has not implemented extraction yet', async () => {
    expect(await manualProvider.extractTasks({ model: 'm', pages: [] })).toBe('unavailable')
    const provider = selectProvider({ env: {} })
    expect(await provider.extractTasks({ model: 'm', pages: [] })).toBe('unavailable')
  })
})
