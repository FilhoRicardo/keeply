import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import { defineConfig, globalIgnores } from 'eslint/config'

// src/domain is pure plan logic: no IO, no framework, no persistence.
export const domainBoundary = {
  files: ['src/domain/**/*.{ts,tsx}'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          { regex: '(^|/)(db|calendar|app|ai)(/|$)|^@/(db|calendar|app|ai)', message: 'src/domain must not import from src/db, src/calendar, src/ai or src/app.' },
          { regex: '^next(/|$)', message: 'src/domain must not import from next.' },
          { regex: '^@supabase/', message: 'src/domain must not import from @supabase/*.' },
        ],
      },
    ],
  },
}

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  domainBoundary,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
])
