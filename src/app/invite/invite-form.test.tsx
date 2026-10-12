// @vitest-environment jsdom
import { act, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithPlan, testRepository } from '../test-utils'
import { InviteForm } from './invite-form'

let search = new URLSearchParams('code=KP-1234-5678-9ABC-DEF0')
vi.mock('next/navigation', () => ({ useSearchParams: () => search }))
afterEach(() => vi.unstubAllGlobals())

describe('InviteForm', () => {
  it('prefills the linked code, redeems it and reports the result', async () => {
    const bodies: unknown[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return Response.json({ result: 'invited' })
      }),
    )
    const events: { name: string }[] = []
    renderWithPlan(<InviteForm />, testRepository(), (e) => void events.push(e))
    expect(screen.getByText(/Sign in with Google on the Home screen to use AI label reading/)).toBeInTheDocument()
    expect(screen.queryByText(/invited testers/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Invite code')).toHaveValue('KP-1234-5678-9ABC-DEF0')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept invite' })))
    expect(bodies).toEqual([{ code: 'KP-1234-5678-9ABC-DEF0' }])
    expect(screen.getByRole('status')).toHaveTextContent('Invite accepted')
    expect(events.map((e) => e.name)).toContain('invite_redeemed')
  })

  it('says when a code is not valid', async () => {
    search = new URLSearchParams()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: 'invalid' })))
    renderWithPlan(<InviteForm />, testRepository())
    expect(screen.getByRole('button', { name: 'Accept invite' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'KP-0000' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Accept invite' })))
    expect(screen.getByRole('alert')).toHaveTextContent('not valid')
  })
})
