import { expect, test, type Page } from '@playwright/test'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { addInterval, type LocalDate } from '../../src/domain/dates'
import type { Interval } from '../../src/domain/format-interval'
import { toRRule } from '../../src/domain/recurrence'

// RF-353: one phone walkthrough of scan → identify → manual → tasks → approve →
// Google Calendar, plus a manual that names a different model. External calls are
// answered inside the server process (e2e/network-fixtures.cjs). This spec does not
// fulfill /api/*: identify, plan, the OAuth callback and event creation all hit the
// real route handlers.

const EXACT_MANUAL = 'https://www.bosch-home.com/manuals/DI6012-1.html'
const JOURNAL = path.join('test-results', 'e2e-network', 'calendar.jsonl')
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

type CalendarCall = {
  method: string
  url: string
  body: {
    summary: string
    description: string
    start: { date: string }
    end: { date: string }
    recurrence?: string[]
  }
}

function readJournal(): CalendarCall[] {
  try {
    return readFileSync(JOURNAL, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CalendarCall)
  } catch {
    return []
  }
}

// Device storage has no Supabase session. The plan route refuses a Brave search
// without some bearer, and KEEPLY_SCAN_ACCESS=open does not check that the token
// is a real session. Continuing the request keeps the server pipeline; the response
// is the route's own.
async function reachPlanRoute(page: Page) {
  await page.route('**/api/plan', async (route) => {
    const headers = { ...route.request().headers() }
    if (!headers.authorization) headers.authorization = 'Bearer e2e-fixtures'
    await route.continue({ headers })
  })
}

async function uploadLabel(page: Page) {
  await reachPlanRoute(page)
  await page.goto('/')
  await page.getByRole('link', { name: 'Scan appliance' }).click()
  await expect(page).toHaveURL(/\/appliances\/scan$/)
  await expect(page.getByRole('heading', { name: 'Photograph the label' })).toBeVisible()
  await page.getByLabel('Take or choose a photo').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await expect(page.getByRole('button', { name: 'Confirm' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Dishwasher', { exact: true })).toBeVisible()
  await expect(page.getByText('Bosch', { exact: true })).toBeVisible()
  await expect(page.getByText('DI6012-1', { exact: true })).toBeVisible()
}

// Google's consent screen is not a Keeply route. The callback and the token
// exchange still run on the server; the token endpoint is answered by the preload.
async function connectCalendar(page: Page) {
  const origin = new URL(page.url()).origin
  await page.route('https://accounts.google.com/**', async (route) => {
    const state = new URL(route.request().url()).searchParams.get('state') ?? ''
    await route.fulfill({
      status: 302,
      headers: { location: `${origin}/auth/google/callback?code=e2e-code&state=${encodeURIComponent(state)}` },
    })
  })
  await page.getByRole('link', { name: 'Connect Google Calendar' }).click()
  await expect(page.getByText('Google Calendar connected.')).toBeVisible({ timeout: 15_000 })
}

test.beforeEach(() => {
  rmSync(JOURNAL, { force: true })
})

test.describe('full owner journey', () => {
  test.describe.configure({ timeout: 60_000 })

  test('scan, confirm, approve, and write only the accepted tasks to Google Calendar', async ({ page }) => {
    await uploadLabel(page)
    await page.getByRole('button', { name: 'Confirm' }).click()

    await expect(page).toHaveURL(/\/appliances\/[^/]+\/plan$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Bosch DI6012-1' })).toBeVisible()
    const card = (name: string) => page.getByRole('article', { name })
    const tasks = [
      ['Clean the filter', 'Every month · from the manual', 'Clean the filter once a month under running water.'],
      ['Descale the appliance', 'Every 6 months · from the manual', 'Descale the appliance every 6 months with a suitable descaler.'],
      ['Check the spray arms', 'Every 3 months · from the manual', 'Check the spray arms every 3 months and clear any blocked holes.'],
    ] as const
    for (const [name, howOften, quote] of tasks) {
      const task = card(name)
      await expect(task.getByText('Manufacturer verified')).toBeVisible()
      await expect(task.locator('.recommended strong')).toHaveText(howOften)
      await task.getByRole('button', { name: 'Why? / View source' }).click()
      await expect(task.getByText(/page 1/)).toBeVisible()
      await expect(task.getByText(`“${quote}”`)).toBeVisible()
      await expect(task.getByRole('link', { name: 'Open' })).toHaveAttribute('href', EXACT_MANUAL)
    }
    expect(readJournal()).toEqual([])

    await connectCalendar(page)
    expect(readJournal()).toEqual([])

    await card('Clean the filter').getByRole('button', { name: 'Accept' }).click()
    await card('Descale the appliance').getByRole('button', { name: 'Accept' }).click()
    await card('Check the spray arms').getByRole('button', { name: 'Reject' }).click()
    await expect(page.getByText('3 of 3 decided')).toBeVisible()
    expect(readJournal()).toEqual([])

    const start = (await page.getByLabel('First reminder on').inputValue()) as LocalDate
    await page.getByRole('button', { name: 'Approve and add 2 tasks to Google Calendar' }).click()
    await expect(page.getByText('Plan approved. Your tasks are in Google Calendar.')).toBeVisible()
    await expect.poll(() => readJournal().length).toBe(2)

    const events = readJournal()
    expect(events).toHaveLength(2)
    expectEvent(events, 'Clean the filter · Bosch DI6012-1', { count: 1, unit: 'month' }, start, 'Every month · from the manual')
    expectEvent(events, 'Descale the appliance · Bosch DI6012-1', { count: 6, unit: 'month' }, start, 'Every 6 months · from the manual')
    expect(events.some((event) => /spray arms/i.test(JSON.stringify(event.body)))).toBe(false)

    await expect(page.getByRole('heading', { name: 'Clean the filter' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Descale the appliance' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Check the spray arms' })).toHaveCount(0)
    await expect(page.getByText('Added')).toHaveCount(2)
    await expect(page.locator('.skipped-note')).toContainText('Rejected')
    await expect(page.locator('.skipped-note')).toContainText('Check the spray arms')
  })

  test('a manual for a different model is not manufacturer verified', async ({ page }) => {
    await uploadLabel(page)
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.getByLabel(/Model number/).fill('DI6012-9')
    await page.getByRole('button', { name: 'Confirm' }).click()

    await expect(page).toHaveURL(/\/appliances\/[^/]+\/plan$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Bosch DI6012-9' })).toBeVisible()
    await expect(page.getByText('Manufacturer verified')).toHaveCount(0)

    const filter = page.getByRole('article', { name: 'Clean the filter' })
    await expect(filter.getByText('Similar-model guidance')).toBeVisible()
    await expect(filter.getByText('Manual for a similar model (DI6012-2). Not verified for your exact model.')).toBeVisible()
    await expect(filter.locator('.covered-model')).toHaveText('DI6012-2')
    await expect(filter.locator('.recommended strong')).toHaveText('Every month · from the manual')
    await filter.getByRole('button', { name: 'Why? / View source' }).click()
    await expect(filter.getByText(/page 1/)).toBeVisible()
    await expect(filter.getByText('“Clean the filter once a month under running water.”')).toBeVisible()
    await expect(filter.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      'https://www.bosch-home.com/manuals/DI6012-2.html',
    )
    expect(readJournal()).toEqual([])
  })
})

function expectEvent(events: CalendarCall[], summary: string, interval: Interval, start: LocalDate, howOften: string) {
  const event = events.find((item) => item.body.summary === summary)
  expect(event).toMatchObject({
    method: 'POST',
    body: {
      summary,
      start: { date: start },
      end: { date: addInterval(start, { count: 1, unit: 'day' }) },
      recurrence: [toRRule(interval, start)],
    },
  })
  expect(event?.url).toContain('/calendars/primary/events')
  expect(event?.body.description).toContain(howOften)
  expect(event?.body.description).toContain('Manufacturer verified')
}
