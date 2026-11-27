import { defineConfig, devices } from '@playwright/test'

/**
 * `e2e/early-taps.spec.ts` in Chromium and WebKit, against a production build
 * served by `scripts/perf/early-taps-check.ts`.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3197'

export default defineConfig({
  testDir: '.',
  testMatch: 'early-taps.spec.ts',
  globalSetup: './global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: 'list',
  use: { baseURL, trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
