// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Home from './page'

describe('Home', () => {
  it('shows the empty Appliance state and manual entry without gated controls', () => {
    render(<Home />)

    expect(screen.getByRole('heading', { name: 'My appliances' })).toBeInTheDocument()
    expect(screen.getByText('No appliances yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add manually' })).toHaveAttribute(
      'href',
      '/appliances/new',
    )
    expect(screen.queryByRole('button', { name: /scan/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /scan/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/sign in/i)).not.toBeInTheDocument()
  })
})
