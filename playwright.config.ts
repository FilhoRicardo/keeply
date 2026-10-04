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
  webServer: {
    command: 'pnpm start -p 3123',
    url: 'http://localhost:3123',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
