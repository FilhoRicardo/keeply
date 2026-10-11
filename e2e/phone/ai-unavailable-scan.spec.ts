import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'

// RF-348: a provider failure must not look like an unreadable photo. This runs against the
// scan-enabled server (port 3124). The default suite stays on the scan-off build.

const PHONE = { width: 375, height: 812 }
const SCREENSHOT_DIR = path.join('test-results', 'ai-unavailable-scan')

// 1×1 PNG. Chromium can decode it, so the scan screen re-encodes and posts the photo.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test.beforeAll(async () => {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
})

test('AI-unavailable scan at 375px shows the manual form and passes axe', async ({ page }) => {
  await page.setViewportSize(PHONE)
  await page.route('**/api/identify', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ identification: null, notice: 'ai_unavailable' }),
    })
  })

  await page.goto('/appliances/scan')
  await expect(page.getByRole('heading', { name: 'Photograph the label' })).toBeVisible()
  await page.getByLabel('Take or choose a photo').setInputFiles({
    name: 'label.png',
    mimeType: 'image/png',
    buffer: PNG,
  })

  await expect(page.getByText('AI label reading is unavailable right now. Enter the details below.')).toBeVisible()
  await expect(page.getByText(/clearer photo/i)).toHaveCount(0)
  await expect(page.getByLabel('Manufacturer')).toBeVisible()
  await expect(page.getByLabel('Manufacturer')).toHaveValue('')
  await expect(page.getByLabel('Appliance', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await accessible(page)
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'ai-unavailable-375.png'), fullPage: true })
})
