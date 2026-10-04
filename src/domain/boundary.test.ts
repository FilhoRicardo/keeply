import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()

async function lint(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result.messages.filter((m) => m.ruleId === 'no-restricted-imports')
}

describe('src/domain import boundary', () => {
  it.each([
    ['src/db', "import { x } from '../db/client'"],
    ['src/calendar', "import { x } from '@/calendar/writer'"],
    ['src/app', "import { x } from '../app/page'"],
    ['next', "import { headers } from 'next/headers'"],
    ['@supabase/*', "import { createClient } from '@supabase/supabase-js'"],
  ])('rejects imports from %s', async (_name, code) => {
    expect(await lint('src/domain/violation.ts', code)).toHaveLength(1)
  })

  it('allows pure imports inside domain', async () => {
    expect(await lint('src/domain/ok.ts', "import { formatInterval } from './format-interval'")).toHaveLength(0)
  })

  it('does not restrict other modules', async () => {
    expect(await lint('src/app/ok.ts', "import { x } from '@/db/client'")).toHaveLength(0)
  })
})
