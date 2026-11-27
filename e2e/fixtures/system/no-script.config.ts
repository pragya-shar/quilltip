import { defineConfig, devices } from '@playwright/test'

// Public reading with JavaScript off (D19), against a production build.
// Started by scripts/system/no-script-check.ts.
export default defineConfig({
  testDir: '../..',
  testMatch: /reading-no-script\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 2,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3197',
    javaScriptEnabled: false,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 390, height: 844 },
      },
    },
  ],
})
