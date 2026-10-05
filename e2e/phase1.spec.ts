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

test('add a dishwasher, accept or reject each task, approve and see the record', async ({ page }) => {
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
  await expect(page.getByText(/not set up on this server/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve plan' })).toBeDisabled()

  await card('Clean the filter').getByRole('button', { name: 'Accept' }).click()
  await card('Run a cleaning cycle').getByRole('button', { name: 'Accept' }).click()
  await card('Check the spray arms').getByRole('button', { name: 'Why? / View source' }).click()
  await expect(card('Check the spray arms').getByText(/could not find model-specific guidance/)).toBeVisible()
  await card('Check the spray arms').getByRole('button', { name: 'Reject' }).click()
  await expect(page.getByText('3 of 3 decided')).toBeVisible()
  await noHorizontalScroll(page)
  await accessible(page)
  await page.getByRole('button', { name: 'Approve plan' }).click()

  await expect(page).toHaveURL(/approved=saved/)
  await expect(page.getByText('Plan approved and saved.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Clean the filter' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check the spray arms' })).toHaveCount(0)
  await expect(page.getByText(/Rejected/)).toBeVisible()
  await noHorizontalScroll(page)
  await accessible(page)

  await page.goto('/')
  await expect(page.getByRole('link', { name: /Bosch SMS6ZCI49E dishwasher/ })).toContainText('2 tasks approved · 2 not in Google Calendar yet')
  expect(problems).toEqual([])
})

test('Google connect without configuration returns safely', async ({ request }) => {
  const response = await request.get('/auth/google/start?returnTo=//evil.example', { maxRedirects: 0 })
  expect(response.status()).toBe(307)
  expect(response.headers().location).toMatch(/^http:\/\/localhost:3123\/\?calendar=unconfigured$/)
  // KEE-49: a same-origin POST without a Google token cookie must answer 401 not_connected.
  // Playwright's request fixture doesn't always set Origin on same-origin posts, so be explicit.
  const events = await request.post('/api/calendar/events', {
    headers: { origin: 'http://localhost:3123' },
    data: { drafts: [] },
  })
  expect(events.status()).toBe(401)
})

test('AI settings require a signed-in Google account and leave manual entry available', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: 'AI settings' }).click()
  await expect(page).toHaveURL(/\/settings\/ai$/)
  await expect(page.getByRole('heading', { name: 'Sign in to Keeply first' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible()
  await expect(page.getByLabel('MiniMax API key')).toHaveCount(0)
  await noHorizontalScroll(page)
  await accessible(page)

  await page.getByRole('link', { name: 'Home' }).click()
  await page.getByRole('link', { name: 'Add manually' }).click()
  await expect(page).toHaveURL(/\/appliances\/new$/)
  await expect(page.getByLabel('Manufacturer')).toBeVisible()
  await noHorizontalScroll(page)
  await accessible(page)
})

test('invite page is accessible and scanning stays shut when it is off', async ({ page, request }) => {
  await page.goto('/invite?code=KP-1234-5678-9ABC-DEF0')
  await expect(page.getByLabel('Invite code')).toHaveValue('KP-1234-5678-9ABC-DEF0')
  await noHorizontalScroll(page)
  await accessible(page)
  expect((await request.get('/appliances/scan')).status()).toBe(404)
  expect((await request.post('/api/identify', { multipart: { photo: { name: 'a.jpg', mimeType: 'image/jpeg', buffer: Buffer.from([0xff, 0xd8]) } } })).status()).toBe(404)
  expect(await (await request.get('/api/scan-access')).json()).toEqual({ ai: false })
  expect((await request.post('/api/scan-access', { data: { code: 'KP-1234-5678-9ABC-DEF0' } })).status()).toBe(503)
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
