import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractTasksFromProvider, planSearchLive } from './orchestration'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extractTasksFromProvider', () => {
  const pages = [{ page: 4, text: 'Clean the filter every month.' }]

  it('is unavailable without calling a provider when OpenRouter is unset, even if a MiniMax key is set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await extractTasksFromProvider({ MINIMAX_API_KEY: 'mm' }, { model: 'KEQB7300L', pages })).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the manual with OpenRouter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  candidates: [
                    {
                      task: 'Clean the filter',
                      instructions: 'Rinse it.',
                      interval: { count: 1, unit: 'month' },
                      page: 4,
                      quote: 'Clean the filter every month.',
                    },
                  ],
                }),
              },
            },
          ],
        }),
      ),
    )
    const result = await extractTasksFromProvider({ OPENROUTER_API_KEY: 'or-key' }, { model: 'KEQB7300L', pages })
    expect(result).toEqual([
      {
        task: 'Clean the filter',
        instructions: 'Rinse it.',
        interval: { count: 1, unit: 'month' },
        page: 4,
        quote: 'Clean the filter every month.',
      },
    ])
  })

  it('turns an OpenRouter rate limit into unavailable and does not call MiniMax', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('openrouter.ai')
      return new Response('{"error":"rate limit"}', { status: 429 })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await extractTasksFromProvider({ OPENROUTER_API_KEY: 'or-key', MINIMAX_API_KEY: 'mm' }, { model: 'KEQB7300L', pages })).toBe('unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.every(([url]) => String(url).includes('openrouter.ai'))).toBe(true)
  })

  it('reads with OpenRouter when a MiniMax key is also set', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toContain('openrouter.ai')
      return Response.json({ choices: [{ message: { content: '{"candidates":[]}' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    expect(await extractTasksFromProvider({ MINIMAX_API_KEY: 'mm', OPENROUTER_API_KEY: 'or' }, { model: 'KEQB7300L', pages })).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('planSearchLive', () => {
  it('is live for OpenRouter alone, and stays off when only MiniMax or nothing is configured', () => {
    expect(planSearchLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1', OPENROUTER_API_KEY: 'or-key' })).toBe(true)
    expect(planSearchLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1', MINIMAX_API_KEY: 'mm' })).toBe(false)
    expect(planSearchLive({ NEXT_PUBLIC_KEEPLY_SCAN: '1' })).toBe(false)
    expect(planSearchLive({ NEXT_PUBLIC_KEEPLY_SCAN: '', OPENROUTER_API_KEY: 'or-key' })).toBe(false)
  })
})
