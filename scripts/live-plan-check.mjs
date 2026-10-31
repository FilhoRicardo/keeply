#!/usr/bin/env node
// VERIFICATION ONLY. Drives a running Keeply server (built with NEXT_PUBLIC_KEEPLY_SCAN=1) through
// the real plan flow on a phone viewport: manual add → /api/plan → plan page with source, page
// and quote → Accept / Reject → Approve → Google Calendar. Writes screenshots, the raw /api/plan
// response, and a single G10 evidence row per case (docs/live-gates.md).
//
//   node scripts/live-plan-check.mjs <base-url> <out-dir> --case <name> \
//       --manufacturer "Electrolux" --model "KEQB7300L" \
//       [--defect KEE-XX] [--note "free-text note"]
//
// `--case` is one of: exact-manual, similar-only, no-manual, scanned-pdf, brave-fail, openrouter-fail,
// calendar-write. The harness is intentionally lossy: it records what the live app does, never
// invents a row. When the runner observes a defect during a run, they pass `--defect KEE-XX` (the
// id of a KEE-… issue filed from the run, per docs/live-gates.md G10 pass criteria "Fix nothing
// silently: file defects as issues") and an optional `--note "…"`; the harness writes them into
// the result and row JSON so the runner can paste the row straight into docs/live-gates.md.
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
const defect = opts.defect === true || opts.defect === '' || opts.defect === undefined ? null : String(opts.defect)
const defectNote = opts.note === true || opts.note === '' || opts.note === undefined ? null : String(opts.note)
if (!base || !outDir) throw new Error('usage: live-plan-check.mjs <base-url> <out-dir> --case <name> --manufacturer "…" [--model "…"] [--defect KEE-XX] [--note "…"]')
if (!caseName) throw new Error('--case is required')
if (!G10_CASES.includes(caseName)) throw new Error(`--case must be one of: ${G10_CASES.join(', ')}`)
if (!manufacturer) throw new Error('--manufacturer is required')
if (defect !== null && !/^KEE-\d+$/.test(defect)) throw new Error(`--defect must look like KEE-NN, got: ${defect}`)

mkdirSync(outDir, { recursive: true })
const label = caseName
const shotPath = (name) => join(outDir, `${label}-${name}.png`)
const jsonPath = (name) => join(outDir, `${label}-${name}.json`)

const EVIDENCE_LABELS = new Set(['Manufacturer verified', 'Similar-model inference', 'General guidance'])

// The @supabase/supabase-js browser client stores its session under
// `sb-<project-ref>-auth-token` in localStorage. The value is a JSON object with `access_token`,
// `refresh_token`, `expires_at`, and the rest of the session shape. The harness reads it to
// forward a Bearer token to /api/g10/calendar-event so the route can hit RLS as the same user.
// Returns null when the app is using the device adapter (no Supabase project) so the caller can
// fall back to "calendar_event_id: n/a" without throwing.
async function readSupabaseAccessToken(page) {
  return page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue
      try {
        const raw = localStorage.getItem(key)
        if (!raw) continue
        const parsed = JSON.parse(raw)
        const token = parsed?.access_token
        if (typeof token === 'string' && token.length > 0) return token
      } catch {
        // localStorage value was malformed; skip and try the next key.
      }
    }
    return null
  })
}

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
  // The runner sets --defect KEE-XX when they file a defect during the run; the harness does not
  // invent defect ids. The free-text --note is recorded alongside, for the runner to paste into
  // the issue or the G10 row.
  defect,
  defectNote,
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
  // time from submit to the first task card being visible. The button text comes from
  // src/app/appliances/new/new-appliance-form.tsx — its primary label is "Continue to maintenance
  // plan" (with the in-flight label "Looking for your manual…"); the regex matches both.
  const t0 = Date.now()
  await page.getByRole('button', { name: /Continue to maintenance plan|Looking for your manual/ }).click()
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

  // 5. The calendar-write case: accept the first task, reject every other task, click Approve.
  // approvalBlockers (src/domain/plan.ts) only returns [] when every task is decided AND at least
  // one is accepted; leaving a task proposed makes the Approve button stay disabled and the
  // harness times out. After Approval we read the accepted task's calendar_event_id from the
  // read-only /api/g10/calendar-event route (it goes through Supabase RLS, so it is safe to call
  // from a same-origin request on a Vercel Preview). The route requires a Bearer token (the same
  // Supabase access token the app forwards to /api/plan and /api/calendar/events); we read it
  // out of the localStorage key the @supabase/supabase-js browser client writes (key shape
  // `sb-<project-ref>-auth-token`, value is a JSON object with `access_token`).
  if (caseName === 'calendar-write') {
    const allCards = await page.locator('article.plan-card').all()
    if (allCards.length === 0) throw new Error('calendar-write case: no plan cards rendered')
    const firstAccept = allCards[0].getByRole('button', { name: 'Accept' })
    await firstAccept.click()
    // Reject every other card (slice(1)). Promise.all so React's state update batch settles before
    // we look at the Approve button.
    const rest = allCards.slice(1)
    await Promise.all(
      rest.map((card) => card.getByRole('button', { name: 'Reject' }).click()),
    )
    await page.screenshot({ path: shotPath('4-accepted'), fullPage: true })
    const approve = page.getByRole('button', { name: /Approve/ })
    // Wait until the blockers clear: the button must be enabled (ready=true in plan-review.tsx).
    await approve.waitFor({ state: 'visible' })
    await page.waitForFunction(
      () => {
        const btn = [...document.querySelectorAll('button')].find((b) => /^Approve/.test(b.textContent ?? ''))
        return btn ? !btn.disabled : false
      },
      undefined,
      { timeout: 30_000 },
    )
    await approve.click()
    // Approval lands on /appliances/<id>?approved=saved (or `calendar` when the calendar write
    // succeeded). Either one carries the appliance id, which we need for the calendar-event read.
    await page.waitForURL(/\/appliances\/[^/?]+\?approved=/, { timeout: 30_000 })
    const approvedUrl = new URL(page.url())
    const applianceId = approvedUrl.pathname.split('/').filter(Boolean).pop()
    await page.screenshot({ path: shotPath('5-approved'), fullPage: true })
    if (applianceId) {
      const accessToken = await readSupabaseAccessToken(page)
      if (accessToken) {
        const bearer = `Bearer ${accessToken}`
        const resp = await page.request.get(
          `${base}/api/g10/calendar-event?applianceId=${encodeURIComponent(applianceId)}`,
          { headers: { Authorization: bearer } },
        )
        if (resp.ok()) {
          const body = await resp.json().catch(() => null)
          result.calendarEventId = body?.calendarEventId ?? null
        } else {
          result.calendarEventId = null
        }
      } else {
        // No Supabase session in the browser — the app is using the device adapter and the
        // /api/g10/calendar-event route is unavailable. Calendar-write in that mode falls back to
        // the older path: the calendar event was written through the device adapter and is not
        // visible from a server route. The runner pastes `n/a` into the G10 row in that case.
        result.calendarEventId = null
      }
    }
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
