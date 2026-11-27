import { defineConfig, devices } from '@playwright/test'

// The Pocket (balance) on the application shell, port 4186. Serve it first:
//   bun e2e/fixtures/pocket/server.mjs
// Phone (390, touch) and desktop (1440) in Chromium and WebKit, and the
// page with JavaScript off in both. Input is real: taps on touch contexts,
// keys on the keyboard, pointer clicks elsewhere.
const phone = { width: 390, height: 844 }
const desktop = { width: 1440, height: 900 }
const scripted = /pocket\.spec\.ts/
const noScript = /pocket-no-script\.spec\.ts/

export default defineConfig({
  testDir: '../..',
  testMatch: /pocket(-no-script)?\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4186', trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium-390',
      testMatch: scripted,
      use: {
        ...devices['Desktop Chrome'],
        viewport: phone,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'webkit-390',
      testMatch: scripted,
      use: { ...devices['Desktop Safari'], viewport: phone, hasTouch: true },
    },
    {
      name: 'chromium-1440',
      testMatch: scripted,
      use: { ...devices['Desktop Chrome'], viewport: desktop },
    },
    {
      name: 'webkit-1440',
      testMatch: scripted,
      use: { ...devices['Desktop Safari'], viewport: desktop },
    },
    {
      name: 'chromium-no-script',
      testMatch: noScript,
      use: {
        ...devices['Desktop Chrome'],
        viewport: phone,
        javaScriptEnabled: false,
      },
    },
    {
      name: 'webkit-no-script',
      testMatch: noScript,
      use: {
        ...devices['Desktop Safari'],
        viewport: phone,
        javaScriptEnabled: false,
      },
    },
  ],
})
