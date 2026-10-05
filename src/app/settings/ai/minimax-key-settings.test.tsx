// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountService } from '../../lib/account'
import type { PlanRepository } from '../../lib/plan-repository'
import { renderWithPlan, testRepository } from '../../test-utils'
import { MiniMaxKeySettings } from './minimax-key-settings'

function googleAccount(): AccountService {
  return {
    current: async () => ({ kind: 'google', email: 'owner@example.com', name: 'Owner' }),
    onChange: () => () => {},
    signInWithGoogle: async () => ({ ok: true }),
    switchToGoogleAccount: async () => ({ ok: true }),
    signOut: async () => {},
  }
}

function authedRepository(): PlanRepository {
  return { ...testRepository(), accessToken: async () => 'google-session-token' }
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('MiniMaxKeySettings', () => {
  it('requires a signed-in Google Keeply account before requesting key status', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    renderWithPlan(<MiniMaxKeySettings />)

    expect(await screen.findByRole('heading', { name: 'Sign in to Keeply first' })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument()
  })

  it('saves a key only to the bearer API, clears the field, and never reads it back', async () => {
    const key = 'mm-secret-test-value'
    let configured = false
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') {
        configured = true
        return new Response(null, { status: 204 })
      }
      return Response.json({ configured, available: true, provider: 'minimax' })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithPlan(<MiniMaxKeySettings />, authedRepository(), undefined, { account: googleAccount() })

    const input = await screen.findByLabelText('MiniMax API key')
    expect(input).toHaveAttribute('type', 'password')
    expect(input).toHaveAttribute('autocomplete', 'off')
    fireEvent.change(input, { target: { value: key } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save key' })))

    expect(fetchMock).toHaveBeenCalledWith('/api/ai-key', expect.objectContaining({
      method: 'PUT',
      headers: { Authorization: 'Bearer google-session-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    }))
    await waitFor(() => expect(input).toHaveValue(''))
    expect(await screen.findByText('MiniMax key saved. Keeply will not show it again.')).toBeInTheDocument()
    expect(screen.queryByText(key)).not.toBeInTheDocument()
    expect(localStorage.length).toBe(0)
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'GET' && String(init.body ?? '').includes(key))).toBe(false)
  })

  it('removes a saved key with DELETE and keeps the field clear', async () => {
    let configured = true
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        configured = false
        return new Response(null, { status: 204 })
      }
      return Response.json({ configured, available: true, provider: 'minimax' })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithPlan(<MiniMaxKeySettings />, authedRepository(), undefined, { account: googleAccount() })

    expect(await screen.findByRole('button', { name: 'Remove saved key' })).toBeInTheDocument()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Remove saved key' })))

    expect(fetchMock).toHaveBeenCalledWith('/api/ai-key', expect.objectContaining({
      method: 'DELETE',
      headers: { Authorization: 'Bearer google-session-token' },
    }))
    expect(await screen.findByText('MiniMax key removed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove saved key' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('MiniMax API key')).toHaveValue('')
  })

  it('shows neutral errors and never echoes a rejected key or server response', async () => {
    const key = 'mm-secret-rejected-value'
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Response.json({ error: `Rejected ${key}` }, { status: 400 })
      return Response.json({ configured: false, available: true, provider: 'minimax' })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithPlan(<MiniMaxKeySettings />, authedRepository(), undefined, { account: googleAccount() })

    const input = await screen.findByLabelText('MiniMax API key')
    fireEvent.change(input, { target: { value: key } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save key' })))

    expect(await screen.findByRole('alert')).toHaveTextContent('The MiniMax key could not be saved. Check it and try again.')
    expect(screen.queryByText(new RegExp(key))).not.toBeInTheDocument()
    expect(screen.queryByText(/Rejected/)).not.toBeInTheDocument()
    expect(input).toHaveValue('')
    expect(localStorage.length).toBe(0)
  })

  it('explains that Token Plan credentials are unsupported without exposing the submitted value', async () => {
    const key = 'sk-cp-secret-test-value'
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return Response.json({ error: 'unsupported_key' }, { status: 400 })
      return Response.json({ configured: false, available: true, provider: 'minimax' })
    })
    vi.stubGlobal('fetch', fetchMock)
    renderWithPlan(<MiniMaxKeySettings />, authedRepository(), undefined, { account: googleAccount() })

    const input = await screen.findByLabelText('MiniMax API key')
    fireEvent.change(input, { target: { value: key } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Save key' })))

    expect(await screen.findByRole('alert')).toHaveTextContent('MiniMax Token Plan keys are not supported. Use a MiniMax API key instead.')
    expect(screen.queryByText(key)).not.toBeInTheDocument()
    expect(input).toHaveValue('')
  })
})
