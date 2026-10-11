import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

// Events the fake Google Calendar accepted. The Playwright process and the Next server share
// this file (both start with the repo as cwd). One JSON object per line.
// The path is a fixed file under test-results so the production bundle does not trace the repo.

export type RecordedCalendarEvent = {
  method: string
  url: string
  body: {
    summary?: string
    description?: string
    recurrence?: string[]
    start?: { date?: string }
    end?: { date?: string }
    id?: string
  }
}

const LOG = path.join(process.cwd(), 'test-results', 'e2e-calendar-log.jsonl')

export function calendarLogPath(): string {
  return LOG
}

export function resetCalendarEvents(): void {
  rmSync(LOG, { force: true })
}

export function recordCalendarEvent(event: RecordedCalendarEvent): void {
  mkdirSync(path.dirname(LOG), { recursive: true })
  appendFileSync(LOG, `${JSON.stringify(event)}\n`)
}

export function readCalendarEvents(): RecordedCalendarEvent[] {
  if (!existsSync(LOG)) return []
  return readFileSync(LOG, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedCalendarEvent)
}
