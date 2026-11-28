import { defineConfig, devices } from '@playwright/test'

// Design system and application shell (port 4185). Serve it first:
//   bun e2e/fixtures/system/server.mjs
// Phone (390, touch), tablet (768) and desktop (1440), in Chromium and
// WebKit. Input is real: taps on touch contexts, keys on the keyboard,
// pointer clicks elsewhere; no synthetic events and no `force`.
const phone = { width: 390, height: 844 }
const tablet = { width: 768, height: 1024 }
const desktop = { width: 1440, height: 900 }

export default defineConfig({
  testDir: '../..',
  testMatch: /system-(gallery|shell)\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 2,
  reporter: 'list',
  timeout: 60_000,
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  snapshotPathTemplate:
    '{testDir}/e2e/__screenshots__/{projectName}/{arg}{ext}',
  use: { baseURL: 'http://127.0.0.1:4185', trace: 'on-first-retry' },
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
      name: 'chromium-768',
      use: { ...devices['Desktop Chrome'], viewport: tablet, hasTouch: true },
    },
    {
      name: 'chromium-1440',
      use: { ...devices['Desktop Chrome'], viewport: desktop },
    },
    {
      name: 'webkit-390',
      use: { ...devices['Desktop Safari'], viewport: phone, hasTouch: true },
    },
    {
      name: 'webkit-768',
      use: { ...devices['Desktop Safari'], viewport: tablet, hasTouch: true },
    },
    {
      name: 'webkit-1440',
      use: { ...devices['Desktop Safari'], viewport: desktop },
    },
  ],
})
