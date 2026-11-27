import { defineConfig, devices } from '@playwright/test'

// Today on its fixture server (port 4188): server-rendered, then hydrated,
// in the real application shell. Serve it first:
//   bun e2e/fixtures/today/server.mjs
// Phone (390, touch) in Chromium and WebKit; width checks at 360, 375 and
// 390 set their own viewport.
const phone = { width: 390, height: 844 }

export default defineConfig({
  testDir: '../..',
  testMatch: /today\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4188', trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium-390',
      use: {
        ...devices['Desktop Chrome'],
        viewport: phone,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'webkit-390',
      use: { ...devices['Desktop Safari'], viewport: phone, hasTouch: true },
    },
  ],
})
