import { defineConfig, devices } from '@playwright/test'

// Sign in on the application shell, port 4250 (SIGNIN_FIXTURE_PORT moves
// both). Serve it first:
//   bun e2e/fixtures/signin/server.mjs
// Phones (360 and 390, touch), tablet (768, touch) and desktop (1440) in
// Chromium and WebKit, and /signin with JavaScript off in both. Input is
// real: taps on touch contexts, keys on the keyboard, pointer clicks
// elsewhere.
const port = Number(process.env.SIGNIN_FIXTURE_PORT ?? 4250)
const small = { width: 360, height: 740 }
const phone = { width: 390, height: 844 }
const tablet = { width: 768, height: 1024 }
const desktop = { width: 1440, height: 900 }
const scripted = /signin\.spec\.ts/
const noScript = /signin-no-script\.spec\.ts/

export default defineConfig({
  testDir: '../..',
  testMatch: /signin(-no-script)?\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'on-first-retry' },
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
      name: 'chromium-360',
      testMatch: scripted,
      use: {
        ...devices['Desktop Chrome'],
        viewport: small,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'webkit-360',
      testMatch: scripted,
      use: { ...devices['Desktop Safari'], viewport: small, hasTouch: true },
    },
    {
      name: 'chromium-768',
      testMatch: scripted,
      use: { ...devices['Desktop Chrome'], viewport: tablet, hasTouch: true },
    },
    {
      name: 'webkit-768',
      testMatch: scripted,
      use: { ...devices['Desktop Safari'], viewport: tablet, hasTouch: true },
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
