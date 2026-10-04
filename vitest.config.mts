import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true, alias: { 'server-only': new URL('./test/server-only-stub.ts', import.meta.url).pathname } },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    exclude: ['**/node_modules/**', '**/*.integration.test.ts', '**/*.live.test.ts', 'e2e/**'],
  },
})
