import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// KEE-43 acceptance: the plan review screen at a 360 px phone viewport
//   - shows the evidence badge, manual link, page and verbatim quote for every task;
//   - never lets a level 2/3 task read as Manufacturer verified;
//   - shows a clear "we could not find a manual" banner when the live search fell
//     back to general guidance, with a stable `data-fallback-reason` we can assert on;
//   - stays accessible (axe-core wcag2a/wcag2aa) and fits the viewport with no
//     horizontal scroll;
//   - captures a 360 px screenshot per path so the PR notes show the result.
//
// The two paths are driven by fixtures seeded into localStorage so the test does
// not depend on a live /api/plan call (the production build runs without
// BRAVE_SEARCH_API_KEY, so the route returns 404 here). The flow is the same
// shape the live proposer would have produced.

const PHONE_VIEWPORT = { width: 360, height: 720 }

const VERIFIED_FIXTURE = {
  version: 2,
  records: [
    {
      appliance: {
        id: 'app-verified',
        manufacturer: 'Bosch',
        model: 'SMS6ZCI49E',
        serialNumber: null,
        identificationConfidence: null,
        createdAt: '2026-10-05T10:00:00Z',
      },
      approvedAt: null,
      startDate: null,
      proposalMeta: { fallback: 'exact', searchOutcome: 'ok', searchReason: null, searched: true },
      tasks: [
        {
          id: 'task-verified-filter',
          applianceId: 'app-verified',
          name: 'Clean the filter',
          instructions: 'Twist out the filter, rinse under warm water, refit.',
          interval: { count: 1, unit: 'month' },
          evidenceLevel: 'manufacturer_verified',
          source: {
            type: 'manufacturer_manual',
            title: 'Bosch SMS6ZCI49E user manual',
            url: 'https://www.bosch-home.com/manual.pdf',
            location: 'page 32',
            quote: 'Clean the filter once a month under running water.',
          },
          status: 'proposed',
          calendarEventId: null,
        },
        {
          id: 'task-verified-arms',
          applianceId: 'app-verified',
          name: 'Check the spray arms',
          instructions: 'Remove the spray arms, check they spin freely.',
          interval: { count: 3, unit: 'month' },
          evidenceLevel: 'general_guidance',
          source: {
            type: 'general_guidance',
            title: 'Keeply general dishwasher maintenance guidance',
            url: null,
            location: null,
            quote: null,
          },
          status: 'proposed',
          calendarEventId: null,
        },
      ],
    },
  ],
}

const FALLBACK_FIXTURE = {
  version: 2,
  records: [
    {
      appliance: {
        id: 'app-fallback',
        manufacturer: 'Bosch',
        model: 'SMV4HVX33E',
        serialNumber: null,
        identificationConfidence: null,
        createdAt: '2026-10-05T10:00:00Z',
      },
      approvedAt: null,
      startDate: null,
      proposalMeta: {
        fallback: 'general',
        searchOutcome: 'no_results',
        searchReason: 'no_key',
        searched: true,
      },
      tasks: [
        {
          id: 'task-fallback-filter',
          applianceId: 'app-fallback',
          name: 'Clean the filter',
          instructions: 'Twist out the filter, rinse it under warm water.',
          interval: { count: 1, unit: 'month' },
          evidenceLevel: 'general_guidance',
          source: {
            type: 'general_guidance',
            title: 'Keeply general dishwasher maintenance guidance',
            url: null,
            location: null,
            quote: null,
          },
          status: 'proposed',
          calendarEventId: null,
        },
        {
          id: 'task-fallback-cycle',
          applianceId: 'app-fallback',
          name: 'Run a cleaning cycle',
          instructions: 'Run the hottest programme empty with a dishwasher cleaner.',
          interval: { count: 1, unit: 'month' },
          evidenceLevel: 'general_guidance',
          source: {
            type: 'general_guidance',
            title: 'Keeply general dishwasher maintenance guidance',
            url: null,
            location: null,
            quote: null,
          },
          status: 'proposed',
          calendarEventId: null,
        },
        {
          id: 'task-fallback-arms',
          applianceId: 'app-fallback',
          name: 'Check the spray arms',
          instructions: 'Remove the spray arms, check they spin freely.',
          interval: { count: 3, unit: 'month' },
          evidenceLevel: 'general_guidance',
          source: {
            type: 'general_guidance',
            title: 'Keeply general dishwasher maintenance guidance',
            url: null,
            location: null,
            quote: null,
          },
          status: 'proposed',
          calendarEventId: null,
        },
      ],
    },
  ],
}

async function seedAndOpen(page: Page, fixture: unknown, applianceId: string, viewport = PHONE_VIEWPORT) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('keeply.plan.v2', value)
  }, JSON.stringify(fixture))
  await page.setViewportSize(viewport)
  await page.goto(`/appliances/${applianceId}/plan`)
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

const SCREENSHOT_DIR = path.join('test-results', 'plan-review-360')

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
})

test('verified plan at 360 px shows source, page, quote, and a level-2/3 row never reads as verified', async ({
  page,
}) => {
  await seedAndOpen(page, VERIFIED_FIXTURE, 'app-verified')

  const verified = page.getByRole('article', { name: 'Clean the filter' })
  await expect(verified).toBeVisible()
  await expect(verified.getByText('Manufacturer verified')).toBeVisible()
  // The chip's wrapper carries the level-specific class so a level-1 row is visually
  // distinct from level-2/3 rows. The level-2/3 row in this fixture is general-guidance.
  await expect(verified.locator('.evidence--manufacturer_verified')).toHaveCount(1)

  const general = page.getByRole('article', { name: 'Check the spray arms' })
  await expect(general.getByText('General guidance')).toBeVisible()
  await expect(general.getByText('Manufacturer verified')).toHaveCount(0)

  // Expand the source details to assert page + quote + manual link.
  await verified.getByRole('button', { name: 'Why? / View source' }).click()
  await expect(verified.getByText(/page 32/)).toBeVisible()
  await expect(verified.getByText('“Clean the filter once a month under running water.”')).toBeVisible()
  await expect(verified.getByRole('link', { name: 'Open' })).toHaveAttribute('href', 'https://www.bosch-home.com/manual.pdf')
  await expect(verified.locator('.recommended strong')).toHaveText('Every month · from the manual')
  await expect(general.locator('.recommended strong')).toHaveText('Every 3 months')

  await noHorizontalScroll(page)
  await accessible(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'verified.png'), fullPage: true })
})

const SEARCH_TIMEOUT_FIXTURE = {
  version: 2,
  records: [
    {
      ...FALLBACK_FIXTURE.records[0],
      appliance: { ...FALLBACK_FIXTURE.records[0].appliance, id: 'app-search-timeout' },
      proposalMeta: {
        fallback: 'general',
        searchOutcome: 'timeout',
        searchReason: 'timeout',
        searched: true,
      },
      tasks: FALLBACK_FIXTURE.records[0].tasks.map((task) => ({
        ...task,
        id: task.id.replace('fallback', 'search-timeout'),
        applianceId: 'app-search-timeout',
      })),
    },
  ],
}

test('search-timeout plan at 360 px does not say manuals were found', async ({ page }) => {
  await seedAndOpen(page, SEARCH_TIMEOUT_FIXTURE, 'app-search-timeout')

  const banner = page.getByTestId('plan-fallback-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('data-fallback-reason', 'search_timeout')
  await expect(banner).toContainText('Keeply could not finish searching for a manual right now')
  await expect(banner).toContainText('Try again')
  await expect(banner).toContainText(/not a manufacturer recommendation/i)
  await expect(banner).not.toContainText(/found manuals/i)
  await expect(page.getByText(/found manuals/i)).toHaveCount(0)
  await expect(page.getByText(/found no guidance for your exact model/i)).toHaveCount(0)

  await noHorizontalScroll(page)
  await accessible(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'search-timeout.png'), fullPage: true })
})

test('fallback plan at 360 px shows the "no manual found" banner with the right reason', async ({ page }) => {
  await seedAndOpen(page, FALLBACK_FIXTURE, 'app-fallback')

  // Banner is visible with a stable data-fallback-reason we can pin.
  const banner = page.getByTestId('plan-fallback-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('data-fallback-reason', 'no_search_key')
  await expect(banner).toHaveText(/not a manufacturer recommendation/i)
  await expect(banner).toHaveText(/could not look for a manual/i)

  // No task may read as Manufacturer verified: the chip class is level-3 and the
  // banner copy is the visible signal the owner is looking at general guidance.
  const list = page.locator('ul.plan-list')
  await expect(list.locator('.evidence--manufacturer_verified')).toHaveCount(0)
  await expect(page.getByText('Manufacturer verified')).toHaveCount(0)

  await noHorizontalScroll(page)
  await accessible(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'fallback.png'), fullPage: true })
})

const SIMILAR_FIXTURE = {
  version: 2,
  records: [
    {
      appliance: {
        id: 'app-similar',
        manufacturer: 'Smeg',
        model: 'DI6012-1',
        serialNumber: null,
        identificationConfidence: null,
        createdAt: '2026-10-05T10:00:00Z',
      },
      approvedAt: null,
      startDate: null,
      proposalMeta: { fallback: 'similar', searchOutcome: 'ok', searchReason: null, searched: true },
      tasks: [
        {
          id: 'task-similar-filter',
          applianceId: 'app-similar',
          name: 'Clean the filter',
          instructions: 'Twist out the filter, rinse under warm water, refit.',
          interval: { count: 1, unit: 'month' },
          evidenceLevel: 'similar_model',
          source: {
            type: 'similar_model_manual',
            title: 'Smeg DI6012 series manual',
            url: 'https://www.smeg.com/di6012.pdf',
            location: 'page 18',
            quote: 'Clean the filter once a month under running water.',
            coveredModel: 'DI6012-2',
          },
          status: 'proposed',
          calendarEventId: null,
        },
        {
          id: 'task-similar-copy',
          applianceId: 'app-similar',
          name: 'Run a cleaning cycle',
          instructions: 'Run a hot cycle monthly to clear grease.',
          interval: { count: 1, unit: 'month' },
          evidenceLevel: 'similar_model',
          source: {
            type: 'similar_model_manual',
            title: 'DI6012-1 user manual',
            url: 'https://manualslib.com/smeg/DI6012-1.pdf',
            location: 'page 9',
            quote: 'Run a hot programme once a month.',
            coveredModel: 'DI6012-1',
          },
          status: 'proposed',
          calendarEventId: null,
        },
        {
          id: 'task-similar-regular',
          applianceId: 'app-similar',
          name: 'Clean the spray arm',
          instructions: 'Clear the holes so they are not clogged.',
          interval: { count: 2, unit: 'week' },
          evidenceLevel: 'similar_model',
          source: {
            type: 'similar_model_manual',
            title: 'Smeg DI6012 series manual',
            url: 'https://www.smeg.com/di6012.pdf',
            location: 'page 23',
            quote: 'Clean the lower spray arm regularly to prevent soil from clogging the holes.',
            coveredModel: 'DI6012-2',
          },
          status: 'proposed',
          calendarEventId: null,
        },
      ],
    },
  ],
}

test('similar-model plan at 375 px shows the badge, covered model, host, page, quote and honest wording', async ({
  page,
}) => {
  await seedAndOpen(page, SIMILAR_FIXTURE, 'app-similar', { width: 375, height: 812 })

  const family = page.getByRole('article', { name: 'Clean the filter' })
  await expect(family.getByText('Similar-model guidance')).toBeVisible()
  await expect(family.getByText('Manufacturer verified')).toHaveCount(0)
  await expect(family.locator('.evidence--similar_model')).toHaveCount(1)
  await expect(family.getByText('Manual for a similar model (DI6012-2). Not verified for your exact model.')).toBeVisible()
  await expect(family.locator('.covered-model')).toHaveText('DI6012-2')
  await expect(family.locator('.recommended strong')).toHaveText('Every month · from the manual')
  await family.getByRole('button', { name: 'Why? / View source' }).click()
  await expect(family.locator('.source-panel')).toContainText('Comparable models in the same product family recommend it.')
  await expect(family.locator('.source-panel')).not.toContainText('third-party site')
  await expect(family.locator('.source-host')).toHaveText('www.smeg.com')
  await expect(family.getByText(/page 18/)).toBeVisible()
  await expect(family.getByText('“Clean the filter once a month under running water.”')).toBeVisible()

  const copy = page.getByRole('article', { name: 'Run a cleaning cycle' })
  await expect(copy.getByText('Similar-model guidance')).toBeVisible()
  await expect(copy.getByText('Manufacturer verified')).toHaveCount(0)
  await expect(copy.getByText('Manual for your model, found on a third-party site (not the manufacturer’s). Not verified.')).toBeVisible()
  await expect(copy.locator('.covered-model')).toHaveText('DI6012-1')
  await expect(copy.locator('.recommended strong')).toHaveText('Every month · from the manual')
  await copy.getByRole('button', { name: 'Why? / View source' }).click()
  await expect(copy.locator('.source-panel')).toContainText(
    'Manual for your model, found on a third-party site (not the manufacturer’s). Not verified.',
  )
  await expect(copy.locator('.source-panel')).not.toContainText('Comparable models in the same product family')
  await expect(copy.locator('.source-host')).toHaveText('manualslib.com')
  await expect(copy.getByText(/page 9/)).toBeVisible()
  await expect(copy.getByText('“Run a hot programme once a month.”')).toBeVisible()

  const regular = page.getByRole('article', { name: 'Clean the spray arm' })
  await expect(regular.getByText('Similar-model guidance')).toBeVisible()
  await expect(regular.getByText('Manufacturer verified')).toHaveCount(0)
  await expect(regular.locator('.recommended strong')).toHaveText(
    'Every month · Keeply\'s suggestion. The manual says "regularly".',
  )

  await expect(page.getByText('Manufacturer verified')).toHaveCount(0)
  await noHorizontalScroll(page)
  await accessible(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'similar-375.png'), fullPage: true })
})

// RF-352: a reload must show the same banner and reason the plan was built with.
// Device storage is what this production build uses; the signed-in round trip is the
// Supabase repository test. An older record with no provenance stays neutral.
function generalPlan(id: string, meta: unknown) {
  const fixture = JSON.parse(JSON.stringify(FALLBACK_FIXTURE)) as {
    records: Array<{
      appliance: { id: string }
      proposalMeta: unknown
      tasks: Array<{ applianceId: string }>
    }>
  }
  const record = fixture.records[0]
  record.appliance.id = id
  record.proposalMeta = meta
  for (const task of record.tasks) task.applianceId = id
  return fixture
}

async function openStoredPlan(page: Page, fixture: unknown, applianceId: string) {
  await page.setViewportSize(PHONE_VIEWPORT)
  await page.addInitScript((value) => {
    window.localStorage.setItem('keeply.plan.v2', value)
  }, JSON.stringify(fixture))
  await page.goto(`/appliances/${applianceId}/plan`)
}

const RELOAD_CASES: {
  name: string
  id: string
  fixture: unknown
  kind: 'verified' | 'similar' | 'banner'
  reason?: string
}[] = [
  { name: 'verified', id: 'app-verified', fixture: VERIFIED_FIXTURE, kind: 'verified' },
  { name: 'similar-model', id: 'app-similar', fixture: SIMILAR_FIXTURE, kind: 'similar' },
  {
    name: 'general-guidance',
    id: 'app-general',
    fixture: generalPlan('app-general', { fallback: 'general', searchOutcome: 'no_results', searchReason: null, searched: true }),
    kind: 'banner',
    reason: 'no_results',
  },
  {
    name: 'extraction-unavailable',
    id: 'app-unread',
    fixture: generalPlan('app-unread', {
      fallback: 'general',
      searchOutcome: 'extraction_unavailable',
      searchReason: null,
      searched: true,
    }),
    kind: 'banner',
    reason: 'extraction_unavailable',
  },
  {
    name: 'timeout',
    id: 'app-timeout',
    fixture: generalPlan('app-timeout', { fallback: 'general', searchOutcome: 'timeout', searchReason: null, searched: true }),
    kind: 'banner',
    reason: 'timeout',
  },
  { name: 'unknown provenance', id: 'app-legacy', fixture: generalPlan('app-legacy', null), kind: 'banner', reason: 'no_proposal_meta' },
]

async function expectPlanReason(page: Page, item: (typeof RELOAD_CASES)[number]) {
  if (item.kind === 'verified') {
    await expect(page.getByText('Manufacturer verified').first()).toBeVisible()
    await expect(page.getByTestId('plan-fallback-banner')).toHaveCount(0)
    return
  }
  if (item.kind === 'similar') {
    await expect(page.getByText('Similar-model guidance').first()).toBeVisible()
    await expect(page.getByText('Manufacturer verified')).toHaveCount(0)
    await expect(page.getByTestId('plan-fallback-banner')).toHaveCount(0)
    return
  }
  const banner = page.getByTestId('plan-fallback-banner')
  await expect(banner).toBeVisible()
  await expect(banner).toHaveAttribute('data-fallback-reason', item.reason!)
  if (item.reason === 'no_results') {
    await expect(banner).toContainText('No manufacturer manual matched this model')
    await expect(banner).toContainText('none named this model on the cover')
    return
  }
  await expect(banner).not.toContainText('No manufacturer manual matched this model')
  await expect(banner).not.toContainText('could not find a manual')
  await expect(page.getByText(/found no guidance for your exact model/i)).toHaveCount(0)
}

for (const item of RELOAD_CASES) {
  test(`reload keeps the ${item.name} plan reason`, async ({ page }) => {
    await openStoredPlan(page, item.fixture, item.id)
    await expectPlanReason(page, item)
    await page.reload()
    await expectPlanReason(page, item)
    if (item.id === 'app-timeout' || item.id === 'app-legacy') {
      await page.screenshot({ path: path.join(SCREENSHOT_DIR, `reload-${item.id}.png`), fullPage: true })
    }
  })
}
