import { defineConfig, devices } from '@playwright/test'

// Crossing from the legacy pages into the shell, with scripts on, against a
// production build (the stored theme and the balance item before paint,
// under the CSP). Run by scripts/app-checks/run.ts.
const phone = { width: 390, height: 844 }

export default defineConfig({
  testDir: '../..',
  testMatch: /shell-crossing\.spec\.ts/,
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
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: phone },
    },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: phone } },
  ],
})
