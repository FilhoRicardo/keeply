import { expect, test, type Page } from '@playwright/test'
import { readCalendarEvents, resetCalendarEvents } from '../../src/e2e-fixtures/calendar-log'
import { ACCEPTED_TASK, EXACT_MODEL, extractionReply, MANUAL_URL, OTHER_MODEL, REJECTED_TASK } from '../../src/e2e-fixtures/fixtures'
import { toRRule } from '../../src/domain/recurrence'

// RF-353. The production server on port 3124 runs the real identify route, plan orchestration,
// evidence classification and calendar route. OpenRouter, Brave, the manual download and
// Google token/event calls are answered at the server's network edge (KEEPLY_E2E_FIXTURES,
// ignored on any Vercel deployment). This spec does not fulfill /api/*.
//
// Google's consent screen is a browser navigation. The test sends that navigation back to
// Keeply's callback; the server then exchanges the code and writes events itself.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const FILTER_QUOTE = extractionReply().candidates[0]!.quote
const ARMS_QUOTE = extractionReply().candidates[1]!.quote

test.beforeEach(() => {
  resetCalendarEvents()
})

async function uploadLabel(page: Page) {
  await page.goto('/appliances/scan')
  await expect(page.getByRole('heading', { name: 'Photograph the label' })).toBeVisible()
  await page.getByLabel('Take or choose a photo').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: PNG,
  })
  await expect(page.getByText(EXACT_MODEL)).toBeVisible()
  await expect(page.getByText('Bosch').first()).toBeVisible()
}

async function completeGoogleConsent(page: Page) {
  await page.route('https://accounts.google.com/**', async (route) => {
    const url = new URL(route.request().url())
    const redirectUri = url.searchParams.get('redirect_uri')
    const state = url.searchParams.get('state')
    if (!redirectUri || !state) {
      await route.abort()
      return
    }
    const back = new URL(redirectUri)
    back.searchParams.set('code', 'e2e-auth-code')
    back.searchParams.set('state', state)
    await route.fulfill({ status: 302, headers: { location: back.toString() } })
  })
}

test('scan, confirm, manual, accept and reject, then Google Calendar', async ({ page }) => {
  test.setTimeout(60_000)
  await uploadLabel(page)
  await page.getByRole('button', { name: 'Confirm' }).click()
  await page.waitForURL(/\/appliances\/[^/]+\/plan/)

  const filter = page.getByRole('article', { name: ACCEPTED_TASK })
  const arms = page.getByRole('article', { name: REJECTED_TASK })
  await expect(filter).toBeVisible()
  await expect(arms).toBeVisible()
  await expect(filter.getByText('Manufacturer verified')).toBeVisible()
  await expect(arms.getByText('Manufacturer verified')).toBeVisible()
  await expect(filter.getByText('Every month · from the manual')).toBeVisible()
  await expect(arms.getByText('Every 3 months · from the manual')).toBeVisible()

  await filter.getByRole('button', { name: 'Why? / View source' }).click()
  await expect(filter.getByText('Bosch SMS6ZCI49E user manual, page 1')).toBeVisible()
  await expect(filter.locator('blockquote')).toHaveText(`“${FILTER_QUOTE}”`)
  await expect(filter.getByRole('link', { name: 'Open' })).toHaveAttribute('href', MANUAL_URL)

  await arms.getByRole('button', { name: 'Why? / View source' }).click()
  await expect(arms.locator('blockquote')).toHaveText(`“${ARMS_QUOTE}”`)

  expect(readCalendarEvents()).toEqual([])

  await completeGoogleConsent(page)
  await page.getByRole('link', { name: 'Connect Google Calendar' }).click()
  await expect(page.getByText('Google Calendar connected.')).toBeVisible()
  expect(readCalendarEvents()).toEqual([])

  await filter.getByRole('button', { name: 'Accept' }).click()
  await arms.getByRole('button', { name: 'Reject' }).click()
  await expect(filter.getByText('Accepted: goes to your calendar when you approve')).toBeVisible()
  await expect(arms.getByText('Rejected: will not be added')).toBeVisible()
  expect(readCalendarEvents()).toEqual([])

  const startDate = await page.locator('input[type="date"]').inputValue()
  await page.getByRole('button', { name: 'Approve and add 1 task to Google Calendar' }).click()
  await expect(page.getByText('Plan approved. Your tasks are in Google Calendar.')).toBeVisible()

  const events = readCalendarEvents()
  expect(events).toHaveLength(1)
  expect(events[0]?.method).toBe('POST')
  expect(events[0]?.body.summary).toBe(`${ACCEPTED_TASK} · Bosch ${EXACT_MODEL}`)
  expect(events[0]?.body.recurrence).toEqual([toRRule({ count: 1, unit: 'month' }, startDate)])
  expect(events[0]?.body.description).toContain('Every month · from the manual')
  expect(events[0]?.body.start?.date).toBe(startDate)
  expect(events.some((event) => (event.body.summary ?? '').includes(REJECTED_TASK))).toBe(false)
  expect(events.some((event) => (event.body.recurrence ?? []).some((rule) => rule.includes('INTERVAL=3')))).toBe(false)
})

test('a manual for a different model is not manufacturer verified', async ({ page }) => {
  test.setTimeout(60_000)
  await uploadLabel(page)
  await page.getByRole('button', { name: 'Edit' }).click()
  await page.getByLabel(/Model number/).fill(OTHER_MODEL)
  await page.getByRole('button', { name: 'Confirm' }).click()
  await page.waitForURL(/\/appliances\/[^/]+\/plan/)

  const filter = page.getByRole('article', { name: ACCEPTED_TASK })
  await expect(filter).toBeVisible()
  await expect(page.getByText('Manufacturer verified')).toHaveCount(0)
  await expect(filter.getByText('Similar-model guidance')).toBeVisible()
  await expect(filter.getByText(`Manual for a similar model (${EXACT_MODEL}). Not verified for your exact model.`)).toBeVisible()
  await expect(filter.getByText(EXACT_MODEL).last()).toBeVisible()
  await filter.getByRole('button', { name: 'Why? / View source' }).click()
  await expect(filter.locator('blockquote')).toHaveText(`“${FILTER_QUOTE}”`)
  await expect(filter.getByText('page 1')).toBeVisible()
  expect(readCalendarEvents()).toEqual([])
})
