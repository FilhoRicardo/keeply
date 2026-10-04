import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Errors that are about the environment, not the app (e.g. fonts blocked by a proxy).
const IGNORED = [/fonts\.(googleapis|gstatic)\.com/, /ERR_CERT_AUTHORITY_INVALID/]

function watchConsole(page: Page) {
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() === 'error' && !IGNORED.some((r) => r.test(m.text()))) problems.push(m.text())
  })
  return problems
}

// WCAG A/AA violations on the current screen (axe-core).
async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
}

test('add a dishwasher, decide, approve and see the record', async ({ page }) => {
  const problems = watchConsole(page)
  await page.goto('/')
  await expect(page.getByText('No appliances yet.')).toBeVisible()
  await noHorizontalScroll(page)
  await accessible(page)

  await page.getByRole('link', { name: 'Add manually' }).click()
  await page.getByLabel('Manufacturer').fill('Bosch')
  await page.getByLabel(/Model number/).fill('SMS6ZCI49E')
  await accessible(page)
  await page.getByRole('button', { name: 'Continue to maintenance plan' }).click()

  await expect(page).toHaveURL(/\/plan$/)
  const card = (name: string) => page.getByRole('article', { name })
  await expect(page.getByText('General guidance')).toHaveCount(3)
  await expect(page.getByText(/manufacturer verified/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review plan' })).toBeDisabled()

  await card('Clean the filter').getByRole('button', { name: 'Include' }).click()
  await card('Run a cleaning cycle').getByRole('button', { name: 'Customise' }).click()
  await card('Run a cleaning cycle').getByLabel('Number').fill('2')
  await card('Run a cleaning cycle').getByLabel('Count from when I last did it').check()
  await card('Run a cleaning cycle').getByRole('button', { name: 'Save' }).click()
  await expect(card('Run a cleaning cycle').getByText(/Customised: Every 2 months/)).toBeVisible()
  await card('Check the spray arms').getByRole('button', { name: 'Why? / View source' }).click()
  await expect(card('Check the spray arms').getByText(/could not find model-specific guidance/)).toBeVisible()
  await card('Check the spray arms').getByRole('button', { name: 'Skip' }).click()
  await noHorizontalScroll(page)
  await accessible(page)

  await page.getByRole('link', { name: 'Review plan' }).click()
  await expect(page).toHaveURL(/\/approve$/)
  await expect(page.getByText(/2 tasks will be added to your calendar, 1 skipped/)).toBeVisible()
  await expect(page.getByText(/not set up on this server/)).toBeVisible()
  await accessible(page)
  await page.getByRole('button', { name: 'Approve maintenance plan' }).click()

  await expect(page).toHaveURL(/approved=saved/)
  await expect(page.getByText('Plan approved and saved on this device.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Clean the filter' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check the spray arms' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Mark done today' }).first().click()
  await expect(page.getByText(/^Done/).first()).toBeVisible()
  await noHorizontalScroll(page)
  await accessible(page)

  await page.goto('/')
  await expect(page.getByRole('link', { name: /Bosch SMS6ZCI49E dishwasher/ })).toContainText('2 active tasks · Next:')
  expect(problems).toEqual([])
})

test('Google connect without configuration returns safely', async ({ request }) => {
  const response = await request.get('/auth/google/start?returnTo=//evil.example', { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  expect(response.headers().location).toMatch(/^http:\/\/localhost:3123\/\?calendar=unconfigured$/)
  expect((await request.post('/api/calendar/events', { data: { drafts: [] } })).status()).toBe(401)
})

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload()
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
  const cached = await page.evaluate(async () => (await caches.open('keeply-static-v1').then((c) => c.keys())).length)
  expect(cached).toBeGreaterThan(0)

  await context.setOffline(true)
  await page.goto('/appliances/new').catch(() => {})
  await expect(page.locator('body')).toContainText(/offline/i)
  await context.setOffline(false)
})
