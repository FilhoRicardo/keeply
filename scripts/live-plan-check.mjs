#!/usr/bin/env node
// VERIFICATION ONLY. Drives a running Keeply server (built with NEXT_PUBLIC_KEEPLY_SCAN=1) through
// the real plan flow on a phone viewport: manual add → /api/plan → plan page with source, page
// and quote → Accept / Reject → Approve → Google Calendar. Writes screenshots, the raw /api/plan
// response, and a single G10 evidence row per case (docs/live-gates.md).
//
//   node scripts/live-plan-check.mjs <base-url> <out-dir> --case <name> \
//       --manufacturer "Electrolux" --model "KEQB7300L"
//
// `--case` is one of: exact-manual, similar-only, no-manual, scanned-pdf, brave-fail, minimax-fail,
// calendar-write. The harness is intentionally lossy: it records what the live app does, never
// invents a row. Defects are noted in the harness output and must be filed as separate KEE-…
// issues by the runner (the issue text says "Fix nothing silently").
//
// PLAYWRIGHT_CHROMIUM_PATH points at a preinstalled browser if needed.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, devices } from '@playwright/test'
import { buildG10Row, isOverTimeTarget, G10_CASES } from './g10-row.mjs'

function parseArgs(argv) {
  const args = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('--')) {
        args[key] = next
        i += 1
      } else {
        args[key] = true
      }
    } else {
      args._.push(a)
    }
  }
  return args
}

const [base, outDir] = parseArgs(process.argv.slice(2))._
const opts = parseArgs(process.argv.slice(2))
const caseName = opts.case
const manufacturer = opts.manufacturer
const model = opts.model === true || opts.model === '' ? null : opts.model ?? null
if (!base || !outDir) throw new Error('usage: live-plan-check.mjs <base-url> <out-dir> --case <name> --manufacturer "…" [--model "…"]')
if (!caseName) throw new Error('--case is required')
if (!G10_CASES.includes(caseName)) throw new Error(`--case must be one of: ${G10_CASES.join(', ')}`)
if (!manufacturer) throw new Error('--manufacturer is required')

mkdirSync(outDir, { recursive: true })
const label = caseName
const shotPath = (name) => join(outDir, `${label}-${name}.png`)
const jsonPath = (name) => join(outDir, `${label}-${name}.json`)

const EVIDENCE_LABELS = new Set(['Manufacturer verified', 'Similar-model inference', 'General guidance'])

const result = {
  case: caseName,
  base,
  query: { manufacturer, model },
  steps: [],
  apiResponse: null,
  visibleTasks: [],
  quoteObservations: [],
  timeToPlanMs: null,
  calendarEventId: null,
  defect: null,
}

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
)
const context = await browser.newContext({ ...devices['Pixel 7'] })
const page = await context.newPage()

// Capture the /api/plan response (or absence) so the runner can paste the exact server truth
// into the G10 row. Same-origin only; the request to another host is out of scope for this gate.
page.on('response', async (response) => {
  if (response.url().endsWith('/api/plan') && response.request().method() === 'POST') {
    try {
      result.apiResponse = { status: response.status(), body: await response.json() }
    } catch {
      result.apiResponse = { status: response.status(), body: null }
    }
  }
})

try {
  // 1. Open the manual add form. The same path the owner drives on a phone.
  await page.goto(`${base}/appliances/new`, { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Manufacturer').fill(manufacturer)
  if (model) await page.getByLabel(/Model number/).fill(model)
  await page.screenshot({ path: shotPath('1-form'), fullPage: true })

  // 2. Time the form-submit → plan-render. The form posts through the local storage adapter
  // (or Supabase, depending on env) and then navigates to /appliances/<id>/plan. We measure the
  // time from submit to the first task card being visible.
  const t0 = Date.now()
  await page.getByRole('button', { name: 'Add dishwasher' }).click()
  await page.waitForURL(/\/appliances\/[^/]+\/plan$/, { timeout: 90_000 })
  await page.locator('article.plan-card').first().waitFor({ timeout: 30_000 })
  result.timeToPlanMs = Date.now() - t0
  await page.screenshot({ path: shotPath('2-plan'), fullPage: true })

  // 3. Read the visible tasks. The DOM has the .evidence--<level> classes and the .source-quote
  // text inside the "Why? / View source" panel, which is collapsed by default — click "Why?" once
  // for the first card so the screenshot captures the source panel.
  const firstCard = page.locator('article.plan-card').first()
  const whyButton = firstCard.getByRole('button', { name: /Why\?|View source/ })
  if (await whyButton.isVisible().catch(() => false)) await whyButton.click()
  await page.screenshot({ path: shotPath('3-source'), fullPage: true })

  const cards = await page.locator('article.plan-card').all()
  for (const card of cards) {
    const name = (await card.locator('h2, h3').first().innerText().catch(() => '')).trim()
    // The evidence label is the human string inside the .evidence--<level> badge.
    const labelEl = card.locator('.evidence-badge').first()
    const labelText = (await labelEl.innerText().catch(() => '')).trim()
    const rendered = [...EVIDENCE_LABELS].find((l) => labelText.includes(l)) ?? null
    // The quote lives inside the source panel, only when one is rendered.
    const quote = (await card.locator('.source-quote').first().innerText().catch(() => '')).trim() || null
    if (name && rendered) {
      result.visibleTasks.push({
        name,
        evidenceLabelRendered: rendered,
        quoteText: quote,
      })
    }
  }
  result.steps.push({ screen: 'plan', taskCount: result.visibleTasks.length })

  // 4. The quote-check pass criterion: for each Manufacturer verified task the harness records
  // the verbatim quote text it observed. The runner (the human or the CTO) re-runs the code path
  // in src/domain/evidence-check.ts:verifyQuote against the document the route fetched, and
  // either confirms pass or files a defect. The harness itself does not re-fetch the document;
  // that would mean the harness is making the gate's own assertion. The point of G10 is to
  // confirm the route's claim, not to re-derive it.
  for (const task of result.visibleTasks) {
    if (task.evidenceLabelRendered === 'Manufacturer verified') {
      result.quoteObservations.push({
        taskName: task.name,
        result: 'n/a', // Confirmed by the runner against src/domain/evidence-check.ts:verifyQuote.
        quote: task.quoteText,
      })
    }
  }
  // Tasks at similar_model and general_guidance do not get a code quote check: only Manufacturer
  // verified does, per docs/HANDOFF.md §23.
  for (const task of result.visibleTasks) {
    if (task.evidenceLabelRendered !== 'Manufacturer verified') {
      result.quoteObservations.push({ taskName: task.name, result: 'n/a', quote: null })
    }
  }

  // 5. The calendar-write case: accept the first task, reject the rest, click Approve, read the
  // calendar_event_id from local storage. Other cases skip this step.
  if (caseName === 'calendar-write') {
    const firstAccept = page.locator('article.plan-card').first().getByRole('button', { name: 'Accept' })
    await firstAccept.click()
    const rejectButtons = await page.locator('article.plan-card').nth(1).getByRole('button', { name: 'Reject' }).all()
    for (const r of rejectButtons) await r.click()
    await page.screenshot({ path: shotPath('4-accepted'), fullPage: true })
    const approve = page.getByRole('button', { name: /Approve/ })
    await approve.click()
    await page.getByText(/Plan approved|Added/).first().waitFor({ timeout: 30_000 })
    await page.screenshot({ path: shotPath('5-approved'), fullPage: true })
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('keeply.plan.v2') ?? '{}'))
    const records = stored.records ?? []
    const accepted = records.flatMap((r) => r.tasks ?? []).find((t) => t.status === 'accepted')
    result.calendarEventId = accepted?.calendarEventId ?? null
  }
} finally {
  await browser.close()
}

// 6. Build the G10 row. The input shape is identical to G10RowInput in src/app/lib/live-plan-row.ts;
// the row logic is mirrored in scripts/g10-row.mjs (cross-checked by a unit test).
const apiResponse = result.apiResponse?.body
const proposals = Array.isArray(apiResponse?.proposals) ? apiResponse.proposals : []
const rowInput = {
  case: caseName,
  query: { manufacturer, model },
  applianceId: null, // The runner fills this from Supabase or local storage if needed.
  response: {
    proposals: proposals.map((p) => ({
      name: String(p.name ?? ''),
      evidenceLevel: p.evidenceLevel,
      source: { title: String(p.source?.title ?? ''), url: p.source?.url ?? null },
    })),
    fallback: apiResponse?.fallback ?? 'general',
    searchOutcome: apiResponse?.searchOutcome ?? 'unavailable',
  },
  visibleTasks: result.visibleTasks,
  quoteObservations: result.quoteObservations,
  timeToPlanMs: result.timeToPlanMs,
  calendarEventId: result.calendarEventId,
  defect: result.defect,
}
const row = buildG10Row(rowInput)

writeFileSync(jsonPath('result'), JSON.stringify(result, null, 2))
writeFileSync(jsonPath('row'), JSON.stringify(row, null, 2))
writeFileSync(
  jsonPath('summary'),
  JSON.stringify(
    {
      case: caseName,
      query: { manufacturer, model },
      row,
      overTimeTarget: isOverTimeTarget(row),
      screenshotCount: 5,
    },
    null,
    2,
  ),
)
console.log(JSON.stringify({ case: caseName, row, overTimeTarget: isOverTimeTarget(row) }, null, 2))
