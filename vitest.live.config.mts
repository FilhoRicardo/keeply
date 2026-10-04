import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Live checks against real third-party APIs; opt-in only (see src/ai/minimax.live.test.ts).
export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true, alias: { 'server-only': new URL('./test/server-only-stub.ts', import.meta.url).pathname } },
  test: { environment: 'node', include: ['src/**/*.live.test.ts'], silent: false, reporters: ['verbose'] },
})
