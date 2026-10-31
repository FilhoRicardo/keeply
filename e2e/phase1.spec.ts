import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Errors that are about the environment, not the app (e.g. fonts blocked by a proxy).
// /api/plan is intentionally disabled in CI/local (no Brave key, no non-Manual AI
// provider) so the live proposer falls back to general guidance; the 404 the
// browser logs is expected, not a code error.
const IGNORED_PATTERNS = [/fonts\.(googleapis|gstatic)\.com/, /ERR_CERT_AUTHORITY_INVALID/]
const IGNORED_URLS = [/\/api\/plan/]

function isIgnored(text: string, url: string): boolean {
  if (IGNORED_PATTERNS.some((r) => r.test(text))) return true
  if (IGNORED_URLS.some((r) => r.test(url))) return true
  return false
}

function watchConsole(page: Page) {
  const problems: string[] = []
  page.on('pageerror', (e) => problems.push(e.message))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const text = m.text()
    const url = m.location()?.url ?? ''
    if (isIgnored(text, url)) return
    problems.push(text)
  })
  page.on('requestfailed', (req) => {
    // Expected: the plan route is disabled in CI/local, fonts may be blocked by the
    // environment, and Next.js RSC prefetches can be aborted when a navigation wins.
    // A failure here is not a code error; the proposer's fallback handles the route.
    if (isIgnored(req.url(), req.url())) return
    if (req.failure()?.errorText === 'net::ERR_ABORTED' && /[?&]_rsc=/.test(req.url())) return
    problems.push(`requestfailed: ${req.url()}`)
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
  // KEE-43: the plan screen also renders a fallback banner whose eyebrow says
  // "General guidance" — so count the per-task chips (level-3 evidence cards)
  // instead of the literal text. The banner is still asserted below by the
  // "could not find model-specific guidance" copy inside the source panel.
  await expect(page.locator('ul.plan-list .evidence--general_guidance')).toHaveCount(3)
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
  // KEE-60: applianceName is appliance-agnostic — the link text is just "Bosch SMS6ZCI49E".
  await expect(page.getByRole('link', { name: /Bosch SMS6ZCI49E/ })).toContainText('2 tasks approved · 2 not in Google Calendar yet')
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

test('BYO AI settings are gone and manual entry remains available', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('link', { name: 'AI settings' })).toHaveCount(0)
  const missing = await page.goto('/settings/ai')
  expect(missing?.status()).toBe(404)
  await expect(page.getByLabel('MiniMax API key')).toHaveCount(0)

  await page.goto('/')
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

// Honest no-plan recovery: a non-dishwasher with no supported tasks stays on the form,
// shows the callout for the intercepted reason, and does not navigate. The scan-confirm
// path is covered in src/app/appliances/flow.test.tsx. Scanning stays off here so the
// existing "scanning stays shut" test still holds.
test('fridge + timeout: recovery callout, retained details, try again, no navigation', async ({ page }) => {
  const problems = watchConsole(page)
  let planCalls = 0
  await page.route('**/api/plan', async (route) => {
    planCalls += 1
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        proposals: [],
        fallback: 'general',
        searchOutcome: 'no_plan',
        searchReason: 'timeout',
      }),
    })
  })

  await page.goto('/appliances/new')
  await page.getByLabel('Appliance', { exact: false }).fill('Fridge')
  await page.getByLabel('Manufacturer').fill('Bosch')
  await page.getByLabel(/Model number/).fill('KGN39VLEB')
  await page.screenshot({ path: 'test-results/kee-60-fridge-manual-form.png' })
  await page.getByRole('button', { name: 'Continue to maintenance plan' }).click()

  const alerts = page.locator('form').getByRole('alert')
  await expect(alerts).toHaveCount(1)
  await expect(alerts.first()).toContainText(/could not finish searching for a manual right now/i)
  await expect(alerts.first()).toContainText(/try again/i)
  await expect(alerts.first()).not.toContainText(/found manuals/i)
  await expect(alerts.first()).not.toContainText(/no manufacturer manual/i)
  await expect(page.getByText(/could not reach your plan/i)).toHaveCount(0)
  await expect(page.getByLabel('Manufacturer')).toHaveValue('Bosch')
  await expect(page.getByLabel(/Model number/)).toHaveValue('KGN39VLEB')
  await expect(page).toHaveURL(/\/appliances\/new$/)
  await accessible(page)
  await noHorizontalScroll(page)
  await page.screenshot({ path: 'test-results/kee-60-fridge-manual-result.png' })

  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(alerts).toHaveCount(1)
  await expect.poll(() => planCalls).toBe(2)
  await expect(page).toHaveURL(/\/appliances\/new$/)
  expect(problems).toEqual([])
})
