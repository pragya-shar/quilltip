import { defineConfig, devices } from '@playwright/test'

// The article view (port 4189). Serve it first:
//   bun e2e/fixtures/read/server.mjs
// Phone (390, touch) and desktop (1440), in Chromium and WebKit. Input is
// real: touch taps on touch contexts, keys on the keyboard, mouse drags on
// the desktop; no synthetic events and no `force`.
const phone = { width: 390, height: 844 }
const desktop = { width: 1440, height: 900 }

export default defineConfig({
  testDir: '../..',
  testMatch: /read\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:4189', trace: 'on-first-retry' },
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
    {
      name: 'chromium-1440',
      use: { ...devices['Desktop Chrome'], viewport: desktop },
    },
    {
      name: 'webkit-1440',
      use: { ...devices['Desktop Safari'], viewport: desktop },
    },
  ],
})
