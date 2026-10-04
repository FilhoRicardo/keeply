import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Integration tests need a running database and PostgREST; see scripts/db-integration.sh.
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true },
  test: { environment: 'node', include: ['src/**/*.integration.test.ts'], fileParallelism: false },
})
