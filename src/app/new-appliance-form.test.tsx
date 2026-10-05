// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithPlan, testRepository } from './test-utils'
import { NewApplianceForm } from './appliances/new/new-appliance-form'

// KEE-43: the new-appliance form swaps to a "Looking for your manual…" progress message while
// the live /api/plan proposer (KEE-42) is in flight. The button is disabled and the busy copy
// is announced to screen readers so the owner is not staring at a button that may take ~25 s.

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}))

beforeEach(() => {
  push.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('NewApplianceForm — progress message while the search runs', () => {
  it('shows "Looking for your manual…" and disables the button while the live fetch is in flight', async () => {
    let resolveFetch: (value: Response) => void = () => {}
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve
          }),
      ),
    )

    const repo = testRepository()
    renderWithPlan(<NewApplianceForm />, repo)

    fireEvent.change(screen.getByLabelText('Manufacturer'), { target: { value: 'Bosch' } })
    fireEvent.change(screen.getByLabelText(/Model number/), { target: { value: 'SMS6ZCI49E' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue to maintenance plan' }))

    // The form must announce the progress to assistive tech and disable the submit button.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Looking for your manual…' })).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Looking for your manual…' })).toBeDisabled()
    expect(screen.getByRole('status')).toHaveTextContent(/looking for your manual/i)
    expect(screen.getByTestId('form-progress')).toBeInTheDocument()

    // Settle the live proposer's fetch (general-guidance fallback), so the form navigates.
    await act(async () => {
      resolveFetch(
        Response.json({
          proposals: [
            {
              name: 'Clean the filter',
              instructions: 'Rinse under warm water.',
              interval: { count: 1, unit: 'month' },
              evidenceLevel: 'general_guidance',
              source: { type: 'general_guidance', title: 'Keeply general guidance', url: null, location: null, quote: null },
            },
          ],
          fallback: 'general',
          searchOutcome: 'no_results',
          searchReason: 'no_key',
        }),
      )
    })
    await waitFor(() => expect(push).toHaveBeenCalledWith('/appliances/app-1/plan'))
  })
})
