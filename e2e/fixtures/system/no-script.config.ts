import { defineConfig, devices } from '@playwright/test'

// Public reading with JavaScript off, against a production build.
// Run by scripts/app-checks/run.ts (the foundation's entry).
const phone = { width: 390, height: 844 }

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
      name: 'chromium-no-script',
      use: { ...devices['Desktop Chrome'], viewport: phone },
    },
    {
      name: 'webkit-no-script',
      use: { ...devices['Desktop Safari'], viewport: phone },
    },
  ],
})
