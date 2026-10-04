#!/usr/bin/env node
// VERIFICATION ONLY. Drives a running Keeply server (built with NEXT_PUBLIC_KEEPLY_SCAN=1) through
// the real browser scan flow on a phone viewport: upload → /api/identify → Confirm / Edit / Rescan,
// or the manual form when nothing is recognised. Saves screenshots and the /api/identify response.
// The photo is sent under a neutral filename so its name never hints at the answer.
//
//   node scripts/live-scan-check.mjs <base-url> <photo> <out-dir> [label]
//
// PLAYWRIGHT_CHROMIUM_PATH points at a preinstalled browser if needed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from '@playwright/test'

const [base, photoPath, outDir, label = 'run'] = process.argv.slice(2)
if (!base || !photoPath || !outDir) throw new Error('usage: live-scan-check.mjs <base-url> <photo> <out-dir> [label]')
mkdirSync(outDir, { recursive: true })
const shot = (page, name) => page.screenshot({ path: join(outDir, `${label}-${name}.png`), fullPage: true })
const mimeType = photoPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg'
const result = { label, base, steps: [] }

const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {})
const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage()
try {
  await page.goto(`${base}/appliances/scan`)
  const identify = page.waitForResponse((r) => r.url().endsWith('/api/identify'), { timeout: 60_000 }).catch(() => null)
  await page.locator('input[type=file]').setInputFiles({ name: 'photo.jpg', mimeType, buffer: readFileSync(photoPath) })
  const response = await identify
  result.identify = response ? { status: response.status(), body: await response.json() } : null
  const panel = page.getByRole('region', { name: 'Confirm identification' })
  await panel.waitFor({ timeout: 60_000 })
  await shot(page, '1-confirm')

  const editButton = panel.getByRole('button', { name: 'Edit' })
  if (await editButton.isVisible()) {
    result.steps.push({ screen: 'proposal', text: (await panel.locator('dl.identity').innerText()).split('\n') })
    await editButton.click()
    const model = panel.getByLabel(/Model number/)
    result.steps.push({ screen: 'edit', manufacturer: await panel.getByLabel('Manufacturer').inputValue(), model: await model.inputValue() })
    await model.fill('EDITED-BY-OWNER')
    await shot(page, '2-edit')
  } else {
    result.steps.push({ screen: 'manual', intro: await panel.locator('.form-intro').first().innerText(), manufacturer: await panel.getByLabel('Manufacturer').inputValue() })
    await panel.getByRole('button', { name: 'Confirm' }).click()
    result.steps.push({ screen: 'manual-empty-confirm', alert: await panel.getByRole('alert').innerText() })
    await panel.getByLabel('Manufacturer').fill('Owner-typed brand')
    await shot(page, '2-manual')
  }

  await panel.getByRole('button', { name: 'Rescan' }).click()
  await page.getByRole('region', { name: 'Photograph the label' }).waitFor()
  result.steps.push({ screen: 'rescan', backToCapture: true })
  await shot(page, '3-rescan')

  // Second pass: accept whatever is proposed (typing a manufacturer if nothing was) and save.
  await page.locator('input[type=file]').setInputFiles({ name: 'photo.jpg', mimeType, buffer: readFileSync(photoPath) })
  await panel.waitFor({ timeout: 60_000 })
  const manufacturer = panel.getByLabel('Manufacturer')
  if (await manufacturer.isVisible()) await manufacturer.fill('Owner-typed brand')
  await panel.getByRole('button', { name: 'Confirm' }).click()
  await page.waitForURL(/\/appliances\/[^/]+\/plan$/, { timeout: 30_000 })
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('keeply.plan.v2') ?? '{}'))
  const appliances = (saved.records ?? []).map(({ appliance }) => appliance)
  result.steps.push({ screen: 'confirmed', url: new URL(page.url()).pathname, appliances })
  await shot(page, '4-saved')
} finally {
  await browser.close()
}
writeFileSync(join(outDir, `${label}-result.json`), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
