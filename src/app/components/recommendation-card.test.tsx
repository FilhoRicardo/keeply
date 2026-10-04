// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { recommendation } from '@/domain/test-fixtures'
import { EvidenceBadge } from './evidence-badge'
import { RecommendationCard } from './recommendation-card'

describe('EvidenceBadge', () => {
  it.each([
    ['manufacturer_verified', 'Manufacturer verified'],
    ['similar_model', 'Similar-model guidance'],
    ['general_guidance', 'General guidance'],
  ] as const)('labels %s distinctly', (level, label) => {
    const { container } = render(<EvidenceBadge level={level} />)
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(container.firstChild).toHaveClass(`evidence--${level}`)
  })

  it.each(['similar_model', 'general_guidance'] as const)('never shows "verified" for %s', (level) => {
    const { container } = render(<EvidenceBadge level={level} explain />)
    expect(container.textContent).not.toMatch(/verified/i)
  })
})

describe('RecommendationCard', () => {
  const rec = recommendation()

  function renderCard(onDecide = vi.fn(), decision?: Parameters<typeof RecommendationCard>[0]['decision']) {
    render(<RecommendationCard recommendation={rec} decision={decision} today="2026-10-04" onDecide={onDecide} />)
    return onDecide
  }

  it('shows the task, recommendation, evidence and an undecided state', () => {
    renderCard()
    expect(screen.getByRole('heading', { name: 'Clean the filter' })).toBeInTheDocument()
    expect(screen.getByText('Every 14 days')).toBeInTheDocument()
    expect(screen.getByText('Manufacturer verified')).toBeInTheDocument()
    expect(screen.getByText('Not decided yet')).toBeInTheDocument()
  })

  it('reveals the source on "Why? / View source"', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Why? / View source' }))
    expect(screen.getByText(/Bosch SMS6ZCI49E user manual, page 32/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', rec.source.reference)
  })

  it('includes and skips', () => {
    const onDecide = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Include' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onDecide.mock.calls).toEqual([[{ kind: 'include' }], [{ kind: 'skip' }]])
  })

  it('marks the chosen decision as pressed', () => {
    renderCard(vi.fn(), { kind: 'skip' })
    expect(screen.getByRole('button', { name: 'Skip' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Include' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('customises frequency, start date and timing while still showing the recommendation', () => {
    const onDecide = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Customise' }))
    expect(screen.getByText('Every 14 days')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '30' } })
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-10-10' } })
    fireEvent.click(screen.getByLabelText('Count from when I last did it'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onDecide).toHaveBeenCalledWith({
      kind: 'customise',
      interval: { count: 30, unit: 'day' },
      startDate: '2026-10-10',
      schedulingMode: 'completion_based',
    })
  })

  it('rejects an invalid frequency', () => {
    const onDecide = renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Customise' }))
    fireEvent.change(screen.getByLabelText('Number'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/at least 1/)
    expect(onDecide).not.toHaveBeenCalled()
  })
})
