import { readFileSync } from 'node:fs'
import path from 'node:path'

// The full-journey e2e fixture set. The HTML manual is the manufacturer's document.
// The JSON files are the canned model replies. Quotes in the extraction reply are copied
// from the manual; classification checks them against the extracted page text.

export const EXACT_MODEL = 'SMS6ZCI49E'
export const OTHER_MODEL = 'SMS6ZCI49X'
export const MANUAL_URL = 'https://www.bosch-home.com/manuals/SMS6ZCI49E.html'
export const MANUAL_TITLE = 'Bosch SMS6ZCI49E user manual'
// TEST-NET-3. Public, and not on the manual-fetch block list, so the SSRF check can pass
// while the fixture response is served in-process. Nothing listens on this address.
export const FIXTURE_MANUAL_IP = '203.0.113.10'

export const ACCEPTED_TASK = 'Clean the filter'
export const REJECTED_TASK = 'Check the spray arms'

export function fixtureFile(name: string): string {
  return readFileSync(path.join(process.cwd(), 'e2e', 'fixtures', name), 'utf8')
}

export function manualHtml(): string {
  return fixtureFile('sms6zci49e-manual.html')
}

export type VisionReply = {
  applianceType: string
  manufacturer: string
  model: string
  serialNumber: string | null
  confidence: number
}

export type ExtractionReply = {
  candidates: Array<{
    task: string
    instructions: string
    interval: { count: number; unit: string }
    page: number
    quote: string
  }>
}

export function visionReply(): VisionReply {
  return JSON.parse(fixtureFile('vision-reply.json')) as VisionReply
}

export function extractionReply(): ExtractionReply {
  return JSON.parse(fixtureFile('extraction-reply.json')) as ExtractionReply
}
