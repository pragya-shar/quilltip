import { defineConfig, devices } from '@playwright/test'

// The article view on a production build, run by scripts/app-checks/run.ts
// (registered in scripts/app-checks/read.ts): the article with JavaScript
// off (public pages must read without scripts), real 404s, the paragraph
// anchor, and the route's content security policy. Chromium and WebKit.
const phone = { width: 390, height: 844 }

export default defineConfig({
  testDir: '../..',
  testMatch: /read-no-script\.spec\.ts/,
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
  ],
})
