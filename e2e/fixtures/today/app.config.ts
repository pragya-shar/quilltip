import { defineConfig, devices } from '@playwright/test'

// Today on a production build, started by scripts/today/app-check.ts: with
// JavaScript off and on, in Chromium and WebKit, at 390.
const phone = { width: 390, height: 844 }

export default defineConfig({
  testDir: '../..',
  testMatch: /today-app\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker: the slow-backend test sets a delay every request shares.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3198',
  },
  projects: [
    {
      name: 'chromium-no-script',
      use: {
        ...devices['Desktop Chrome'],
        viewport: phone,
        javaScriptEnabled: false,
      },
    },
    {
      name: 'webkit-no-script',
      use: {
        ...devices['Desktop Safari'],
        viewport: phone,
        javaScriptEnabled: false,
      },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: phone },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: phone },
    },
  ],
})
