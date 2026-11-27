import { defineConfig, devices } from '@playwright/test'

// The application shell on a production build, started by
// scripts/system/no-script-check.ts: public reading with JavaScript off
// (D19), in Chromium and WebKit; and the crossing from the legacy pages
// (the stored theme before paint, under the CSP), with JavaScript on.
const phone = { width: 390, height: 844 }

export default defineConfig({
  testDir: '../..',
  testMatch: /(reading-no-script|shell-crossing)\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3197',
  },
  projects: [
    {
      name: 'chromium-no-script',
      testMatch: /reading-no-script\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: phone,
        javaScriptEnabled: false,
      },
    },
    {
      name: 'webkit-no-script',
      testMatch: /reading-no-script\.spec\.ts/,
      use: {
        ...devices['Desktop Safari'],
        viewport: phone,
        javaScriptEnabled: false,
      },
    },
    {
      name: 'chromium',
      testMatch: /shell-crossing\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], viewport: phone },
    },
    {
      name: 'webkit',
      testMatch: /shell-crossing\.spec\.ts/,
      use: { ...devices['Desktop Safari'], viewport: phone },
    },
  ],
})
