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

async function seedAndOpen(page: Page, fixture: unknown, applianceId: string) {
  await page.addInitScript((value) => {
    window.localStorage.setItem('keeply.plan.v2', value)
  }, JSON.stringify(fixture))
  await page.setViewportSize(PHONE_VIEWPORT)
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

  await noHorizontalScroll(page)
  await accessible(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'verified.png'), fullPage: true })
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
