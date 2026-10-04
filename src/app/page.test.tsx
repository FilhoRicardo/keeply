// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import Home from './page'

it('renders the default page', () => {
  render(<Home />)
  expect(screen.getByRole('heading', { name: 'Keeply' })).toBeInTheDocument()
})
