import { defineConfig, devices } from '@playwright/test'

// Phase 1 walkthrough on a phone-sized viewport against a production build.
// Locally: `pnpm build && pnpm e2e`. PLAYWRIGHT_CHROMIUM_PATH points at a preinstalled browser if needed.
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:3123',
    ...devices['Pixel 7'],
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  projects: [
    { name: 'mvp', testIgnore: /ai-unavailable-scan\.spec\.ts/ },
    { name: 'scan', testMatch: /ai-unavailable-scan\.spec\.ts/, use: { baseURL: 'http://localhost:3124' } },
  ],
  webServer: [
    {
      command: 'pnpm start -p 3123',
      url: 'http://localhost:3123',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // Scanning is off in the default production build. This server is built with the flag
      // so the phone scenario can open the scan screen without turning scanning on for the
      // rest of the suite.
      command:
        'NEXT_DIST_DIR=.next-scan NEXT_PUBLIC_KEEPLY_SCAN=1 pnpm exec next build && NEXT_DIST_DIR=.next-scan pnpm exec next start -p 3124',
      url: 'http://localhost:3124',
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
})
