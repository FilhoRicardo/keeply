// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Home from './page'
import { renderWithPlan } from './test-utils'

describe('Home', () => {
  it('shows the empty Appliance state and manual entry without gated controls', async () => {
    renderWithPlan(<Home />)

    expect(screen.getByRole('heading', { name: 'My appliances' })).toBeInTheDocument()
    expect(await screen.findByText('No appliances yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add manually' })).toHaveAttribute(
      'href',
      '/appliances/new',
    )
    expect(screen.queryByRole('button', { name: /scan/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /scan/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'AI settings' })).not.toBeInTheDocument()
    expect(screen.queryByText(/MiniMax/i)).not.toBeInTheDocument()
  })
})

