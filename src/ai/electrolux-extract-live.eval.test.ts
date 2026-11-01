import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ExtractedPage } from './extraction'
import { extractTasksWithOpenRouter, openrouterConfig } from './openrouter'

const fixturePath = fileURLToPath(new URL('../test-fixtures/electrolux-keqb7300l-care-pages.json', import.meta.url))
const carePages = JSON.parse(readFileSync(fixturePath, 'utf8')) as ExtractedPage[]

function keqb7300lManualPages(): ExtractedPage[] {
  const byPage = new Map(carePages.map((p) => [p.page, p]))
  const pages: ExtractedPage[] = [
    { page: 1, text: 'electrolux dishwasher KEQB7300L user manual. model KEQB7300L.' },
    { page: 2, text: 'safety information and installation.' },
  ]
  for (let p = 3; p <= 31; p++) {
    pages.push(byPage.get(p) ?? { page: p, text: `page ${p}. general use.` })
  }
  return pages
}

// Not CI: needs OPENROUTER_API_KEY. Run with `pnpm eval:extract-electrolux`.
describe.skipIf(!process.env.OPENROUTER_API_KEY?.trim())('live Electrolux KEQB7300L extraction eval', () => {
  it(
    'returns a stable task set across three runs',
    async () => {
      const config = openrouterConfig({
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
        OPENROUTER_MODEL: process.env.OPENROUTER_MODEL?.trim() || 'google/gemini-2.5-flash-lite',
      })
      expect(config).not.toBeNull()
      const pages = keqb7300lManualPages()
      const signatures: string[] = []
      for (let run = 0; run < 3; run += 1) {
        const tasks = await extractTasksWithOpenRouter(config!, pages)
        signatures.push(tasks.map((t) => t.task).sort().join('|'))
        console.log(`run ${run + 1}:`, tasks.map((t) => t.task).sort())
      }
      expect(new Set(signatures).size).toBe(1)
      expect(signatures[0]).toMatch(/filter/i)
      expect(signatures[0]).toMatch(/gasket|door/i)
      expect(signatures[0]).toMatch(/machine care|cleaning product/i)
    },
    120_000,
  )
})
