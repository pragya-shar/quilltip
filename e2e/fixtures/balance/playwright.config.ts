import { defineConfig, devices } from '@playwright/test'

// Balance fixtures (port 4184): the passage tip, balance and earnings
// screens in every state, on the real payments provider and hooks. Serve
// them first:
//   bun e2e/fixtures/balance/server.mjs
// Phone first (390 x 844, touch, in Chromium and WebKit), then tablet and
// desktop.
export default defineConfig({
  testDir: '../..',
  testMatch: /balance-tip\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: 'list',
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4184', trace: 'on-first-retry' },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
      },
    },
    {
      // Mobile WebKit at the same size: the iPhone engine.
      name: 'phone-webkit',
      use: {
        ...devices['iPhone 13'],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'tablet',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
})
