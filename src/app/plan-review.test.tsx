// @vitest-environment jsdom
import { fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithPlan, testRepository } from './test-utils'
import { PlanReview } from './appliances/[id]/plan/plan-review'

// KEE-43 acceptance: the plan screen shows source, page and quote for every task; renders a clear
// fallback banner when the live search could not find a manufacturer manual; never lets level 2/3
// evidence read as Manufacturer verified; and shows a "looking for your manual" progress message
// while the proposal is still being built.

const push = vi.fn()
let search = new URLSearchParams()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => search,
}))

const VERIFIED_PROPOSAL = {
  name: 'Clean the filter',
  instructions: 'Twist out the filter, rinse under warm water, refit.',
  interval: { count: 1, unit: 'month' as const },
  evidenceLevel: 'manufacturer_verified' as const,
  source: {
    type: 'manufacturer_manual' as const,
    title: 'Bosch SMS6ZCI49E user manual',
    url: 'https://www.bosch-home.com/manual.pdf',
    location: 'page 32',
    quote: 'Clean the filter once a month under running water.',
  },
}

const SIMILAR_PROPOSAL = {
  name: 'Run a cleaning cycle',
  instructions: 'Run a cleaning cycle monthly to clear grease and limescale.',
  interval: { count: 1, unit: 'month' as const },
  evidenceLevel: 'similar_model' as const,
  source: {
    type: 'similar_model_manual' as const,
    title: 'Bosch SMS6 series manual',
    url: 'https://www.bosch-home.com/sms6.pdf',
    location: 'page 18',
    quote: 'Run a hot cycle once a month.',
  },
}

const GENERAL_PROPOSAL = {
  name: 'Check the spray arms',
  instructions: 'Remove the spray arms, check they spin freely.',
  interval: { count: 3, unit: 'month' as const },
  evidenceLevel: 'general_guidance' as const,
  source: {
    type: 'general_guidance' as const,
    title: 'Keeply general dishwasher maintenance guidance',
    url: null,
    location: null,
    quote: null,
  },
}

beforeEach(() => {
  push.mockReset()
  search = new URLSearchParams()
})

afterEach(() => vi.unstubAllGlobals())

function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => handler(url)))
}

function stubCalendarConfigured() {
  stubFetch(async (url) => {
    if (url === '/api/calendar/status') return Response.json({ configured: true, connected: false })
    throw new Error(`unexpected fetch ${url}`)
  })
}

describe('PlanReview — source, page and quote', () => {
  it('shows the source title, page, link and verbatim quote for a verified task', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' },
      [VERIFIED_PROPOSAL],
      { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const card = await screen.findByRole('article', { name: 'Clean the filter' })
    expect(within(card).getByText('Manufacturer verified')).toBeInTheDocument()
    // The source details (title, page, quote, link) live behind "Why? / View source". Expand
    // them so the owner can see exactly which document each verified task came from.
    fireEvent.click(within(card).getByRole('button', { name: 'Why? / View source' }))
    expect(within(card).getByText(/page 32/)).toBeInTheDocument()
    expect(within(card).getByText('“Clean the filter once a month under running water.”')).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://www.bosch-home.com/manual.pdf')
    expect(within(card).getByText('Every month · from the manual')).toBeInTheDocument()
  })

  it('labels a quote with no cadence as Keeply’s suggestion and stays Manufacturer verified', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Electrolux', model: 'KEQB7300L', serialNumber: '' },
      [
        {
          name: 'Clean the spray arm',
          instructions: 'Clear the holes.',
          interval: { count: 2, unit: 'week' as const },
          evidenceLevel: 'manufacturer_verified' as const,
          source: {
            type: 'manufacturer_manual' as const,
            title: 'Electrolux KEQB7300L user manual',
            url: 'https://www.electrolux.com/keqb7300l.pdf',
            location: 'page 23',
            quote: 'We recommend to clean the lower spray arm regularly to prevent soil from clogging the holes.',
          },
        },
      ],
      { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const card = await screen.findByRole('article', { name: 'Clean the spray arm' })
    expect(within(card).getByText('Manufacturer verified')).toBeInTheDocument()
    expect(within(card).getByText('Every month · Keeply\'s suggestion. The manual says "regularly".')).toBeInTheDocument()
    expect(within(card).queryByText('Every 2 weeks')).not.toBeInTheDocument()
    expect(within(card).queryByText(/from the manual/)).not.toBeInTheDocument()
  })

  it('keeps a level-2 (Similar-model) row visually distinct from verified', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' },
      [SIMILAR_PROPOSAL, GENERAL_PROPOSAL],
      { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const similar = await screen.findByRole('article', { name: 'Run a cleaning cycle' })
    // The chip is "Similar-model guidance" — never "Manufacturer verified".
    expect(within(similar).getByText('Similar-model guidance')).toBeInTheDocument()
    expect(within(similar).queryByText('Manufacturer verified')).not.toBeInTheDocument()
    // The chip is wrapped in an evidence-level-specific class so CSS keeps it visually distinct.
    const similarChip = within(similar).getByText('Similar-model guidance').closest('.evidence')!
    expect(similarChip.className).toContain('evidence--similar_model')
    expect(similarChip.className).not.toContain('evidence--manufacturer_verified')

    const general = screen.getByRole('article', { name: 'Check the spray arms' })
    expect(within(general).queryByText('Manufacturer verified')).not.toBeInTheDocument()
    const generalChip = within(general).getByText('General guidance').closest('.evidence')!
    expect(generalChip.className).toContain('evidence--general_guidance')
    expect(within(general).getByText('Every 3 months')).toBeInTheDocument()
    expect(within(general).queryByText(/Keeply's suggestion|from the manual/)).not.toBeInTheDocument()
  })

  it('shows similar-model wording, the covered model, host, page and quote for a family match', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Smeg', model: 'DI6012-1', serialNumber: '' },
      [
        {
          name: 'Clean the filter',
          instructions: 'Twist out the filter, rinse under warm water, refit.',
          interval: { count: 1, unit: 'month' as const },
          evidenceLevel: 'similar_model' as const,
          source: {
            type: 'similar_model_manual' as const,
            title: 'Smeg DI6012 series manual',
            url: 'https://www.smeg.com/di6012.pdf',
            location: 'page 18',
            quote: 'Clean the filter once a month under running water.',
            coveredModel: 'DI6012-2',
          },
        },
      ],
      { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const card = await screen.findByRole('article', { name: 'Clean the filter' })
    expect(within(card).getByText('Similar-model guidance')).toBeInTheDocument()
    expect(within(card).queryByText('Manufacturer verified')).not.toBeInTheDocument()
    expect(within(card).getByText('Manual for a similar model (DI6012-2). Not verified for your exact model.')).toBeInTheDocument()
    expect(within(card).getByText('DI6012-2')).toBeInTheDocument()

    fireEvent.click(within(card).getByRole('button', { name: 'Why? / View source' }))
    const panel = within(card).getByText('www.smeg.com').closest('.source-panel') as HTMLElement
    expect(within(panel).getByText(/Comparable models in the same product family recommend it/)).toBeInTheDocument()
    expect(within(panel).queryByText(/third-party site/)).not.toBeInTheDocument()
    expect(within(card).getByText('www.smeg.com')).toBeInTheDocument()
    expect(within(card).getByText(/page 18/)).toBeInTheDocument()
    expect(within(card).getByText('“Clean the filter once a month under running water.”')).toBeInTheDocument()
  })

  it('says a third-party copy of the exact model is not verified', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Smeg', model: 'DI6012-1', serialNumber: '' },
      [
        {
          name: 'Clean the filter',
          instructions: 'Twist out the filter, rinse under warm water, refit.',
          interval: { count: 1, unit: 'month' as const },
          evidenceLevel: 'similar_model' as const,
          source: {
            type: 'similar_model_manual' as const,
            title: 'DI6012-1 user manual',
            url: 'https://manualslib.com/smeg/DI6012-1.pdf',
            location: 'page 9',
            quote: 'Clean the filter once a month under running water.',
            coveredModel: 'DI6012-1',
          },
        },
      ],
      { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const card = await screen.findByRole('article', { name: 'Clean the filter' })
    expect(within(card).getByText('Similar-model guidance')).toBeInTheDocument()
    expect(within(card).queryByText('Manufacturer verified')).not.toBeInTheDocument()
    expect(
      within(card).getByText('Manual for your model, found on a third-party site (not the manufacturer’s). Not verified.'),
    ).toBeInTheDocument()
    expect(within(card).getByText('DI6012-1')).toBeInTheDocument()

    const thirdParty = 'Manual for your model, found on a third-party site (not the manufacturer’s). Not verified.'
    fireEvent.click(within(card).getByRole('button', { name: 'Why? / View source' }))
    const panel = within(card).getByText('manualslib.com').closest('.source-panel') as HTMLElement
    expect(within(panel).getByText(thirdParty)).toBeInTheDocument()
    expect(within(panel).queryByText(/Comparable models in the same product family/)).not.toBeInTheDocument()
    expect(within(card).getAllByText(thirdParty)).toHaveLength(2)
    expect(within(card).getByText('manualslib.com')).toBeInTheDocument()
    expect(within(card).getByText(/page 9/)).toBeInTheDocument()
    expect(within(card).getByText('“Clean the filter once a month under running water.”')).toBeInTheDocument()
  })
})

describe('PlanReview — fallback banner when the search cannot find a manual', () => {
  it('shows a clear "we could not find a manual" banner with the reason on a general-guidance plan', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' },
      [GENERAL_PROPOSAL],
      {
        fallback: 'general',
        searchOutcome: 'no_results',
        searchReason: 'no_key',
        searched: true,
      },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const banner = await screen.findByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', 'no_search_key')
    expect(banner).toHaveTextContent(/could not look for a manual for this model/i)
    expect(banner).toHaveTextContent(/not a manufacturer recommendation/i)
  })

  it('shows a different reason when the search was disabled', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' },
      [GENERAL_PROPOSAL],
      {
        fallback: 'general',
        searchOutcome: 'unavailable',
        searchReason: 'plan_search_disabled',
        searched: false,
      },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const banner = await screen.findByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', 'plan_search_disabled')
    expect(banner).toHaveTextContent(/manual search is not enabled/i)
  })

  it('shows a quota-exhausted reason without crashing', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' },
      [GENERAL_PROPOSAL],
      { fallback: 'general', searchOutcome: 'quota_exhausted', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const banner = await screen.findByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', 'quota_exhausted')
  })

  it('does not show a fallback banner when a verified task is present', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' },
      [VERIFIED_PROPOSAL, GENERAL_PROPOSAL],
      { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    expect(await screen.findByText('Manufacturer verified')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-fallback-banner')).not.toBeInTheDocument()
  })

  it.each([
    ['extraction_unavailable', 'extraction_unavailable'],
    ['timeout', 'timeout'],
  ] as const)('tells a dishwasher owner the manuals could not be read when the outcome is %s', async (outcome, reason) => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Electrolux', model: 'KEQB7300L', serialNumber: '' },
      [GENERAL_PROPOSAL],
      { fallback: 'general', searchOutcome: outcome, searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const banner = await screen.findByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', reason)
    expect(banner).toHaveTextContent(
      'Keeply found manuals but could not read them right now. These are general dishwasher tasks, not a manufacturer recommendation.',
    )
    expect(banner).not.toHaveTextContent(/no manufacturer manual found/i)
    expect(banner).not.toHaveTextContent(/could not find a manual/i)
    expect(screen.queryByText(/found no guidance for your exact model/i)).not.toBeInTheDocument()
  })

  it('does not say manuals were found when the search itself timed out', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Electrolux', model: 'KEQB7300L', serialNumber: '' },
      [GENERAL_PROPOSAL],
      { fallback: 'general', searchOutcome: 'timeout', searchReason: 'timeout', searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const banner = await screen.findByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', 'search_timeout')
    expect(banner).toHaveTextContent(
      'Keeply could not finish searching for a manual right now. Try again. These are general guidance tasks. They are not a manufacturer recommendation.',
    )
    expect(banner).not.toHaveTextContent(/found manuals/i)
    expect(screen.queryByText(/found no guidance for your exact model/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/found manuals/i)).not.toBeInTheDocument()
  })

  it('keeps the no-manual wording when the search found nothing', async () => {
    const repo = testRepository()
    await repo.addAppliance(
      { manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' },
      [GENERAL_PROPOSAL],
      { fallback: 'general', searchOutcome: 'no_results', searchReason: null, searched: true },
    )
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const banner = await screen.findByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', 'no_results')
    expect(banner).toHaveTextContent('No manufacturer manual found for this model.')
    expect(banner).toHaveTextContent('Keeply could not find a manual for this model.')
    expect(screen.getByText(/found no guidance for your exact model/i)).toBeInTheDocument()
  })

  it('shows a neutral banner for older records without proposalMeta', async () => {
    // A pre-RF-352 snapshot has no proposalMeta and every task is general guidance. The owner
    // still needs to see that these are not manufacturer recommendations, but Keeply must not
    // claim it looked and found no manual.
    const repo = testRepository()
    await repo.addAppliance({ manufacturer: 'Bosch', model: 'SMS6ZCI49E', serialNumber: '' }, [GENERAL_PROPOSAL])
    stubCalendarConfigured()
    renderWithPlan(<PlanReview applianceId="app-1" />, repo)

    const banner = await screen.findByTestId('plan-fallback-banner')
    expect(banner).toHaveAttribute('data-fallback-reason', 'no_proposal_meta')
    expect(banner).toHaveTextContent(/general guidance/i)
    expect(banner).toHaveTextContent(/not a manufacturer recommendation/i)
    expect(banner).not.toHaveTextContent(/no manufacturer manual found/i)
    expect(banner).not.toHaveTextContent(/could not find a manual/i)
    expect(screen.queryByText(/found no guidance for your exact model/i)).not.toBeInTheDocument()
  })
})
