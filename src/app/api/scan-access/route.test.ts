import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

const session = { authorization: 'Bearer user-session-token' }
const get = (headers: Record<string, string> = session) => GET(new NextRequest('http://keeply.local/api/scan-access', { headers }))
const redeem = (code: unknown, headers: Record<string, string> = session) =>
  POST(new NextRequest('http://keeply.local/api/scan-access', { method: 'POST', body: JSON.stringify({ code }), headers }))

function configure(rpc: (name: string, body: unknown) => Response) {
  vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
  vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
  vi.stubEnv('MINIMAX_API_KEY', 'server-key')
  vi.stubEnv('KEEPLY_SCAN_ACCESS', '')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.example')
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input instanceof Request ? input.url : input)
      calls.push(url)
      if (url.includes('/auth/v1/user')) {
        return Response.json({ id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated', is_anonymous: true })
      }
      const name = /\/rpc\/(\w+)/.exec(url)?.[1] ?? ''
      return rpc(name, init?.body ? JSON.parse(String(init.body)) : null)
    }),
  )
  return calls
}

describe('GET /api/scan-access', () => {
  it('reports no AI when scanning is off, OpenRouter is unset, or only MiniMax is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '')
    vi.stubEnv('OPENROUTER_API_KEY', 'or-key')
    expect(await (await get()).json()).toEqual({ ai: false })
    vi.stubEnv('NEXT_PUBLIC_KEEPLY_SCAN', '1')
    vi.stubEnv('OPENROUTER_API_KEY', '')
    vi.stubEnv('MINIMAX_API_KEY', 'server-key')
    expect(await (await get()).json()).toEqual({ ai: false })
  })

  it('reports an invited tester’s scans left, from Supabase', async () => {
    configure(() => Response.json({ status: 'invited', tester_left: 4, global_left: 90 }))
    expect(await (await get()).json()).toEqual({ ai: true, access: 'invited', testerLeft: 4, globalLeft: 90 })
  })

  it('reports a Google sign-in’s allowance with the personal and shared counts', async () => {
    configure(() => Response.json({ status: 'invited', tester_left: 10, global_left: 12 }))
    expect(await (await get()).json()).toEqual({ ai: true, access: 'invited', testerLeft: 10, globalLeft: 12 })
  })

  it('reports no invite, and is unavailable without a session', async () => {
    const calls = configure(() => Response.json({ status: 'no_invite', tester_left: 5, global_left: 100 }))
    expect(await (await get()).json()).toEqual({ ai: true, access: 'no_invite' })
    expect(await (await get({})).json()).toEqual({ ai: true, access: 'unavailable' })
    expect(calls.filter((url) => url.includes('/rest/v1/rpc/'))).toHaveLength(1)
  })
})

describe('POST /api/scan-access', () => {
  it('redeems a code for the caller', async () => {
    let sent: unknown = null
    configure((name, body) => {
      sent = { name, body }
      return Response.json('invited')
    })
    expect(await (await redeem('KP-1234-5678-9ABC-DEF0')).json()).toEqual({ result: 'invited' })
    expect(sent).toEqual({ name: 'redeem_scan_invite', body: { p_code: 'KP-1234-5678-9ABC-DEF0' } })
  })

  it('rejects malformed codes and missing sessions without calling Supabase', async () => {
    const calls = configure(() => Response.json('invited'))
    expect((await redeem(42)).status).toBe(400)
    expect((await redeem('x'.repeat(41))).status).toBe(400)
    expect((await redeem('KP-1234', {})).status).toBe(503)
    expect(calls).toHaveLength(0)
  })
})
