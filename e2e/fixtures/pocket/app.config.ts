import { defineConfig, devices } from '@playwright/test'

// The balance page against a production build, with JavaScript off, in
// Chromium and WebKit: what the server sends before any script, and the
// legacy dashboard paths it answers. Run by scripts/app-checks/run.ts
// (the pocket package's entry).
const phone = { width: 390, height: 844 }

export default defineConfig({
  testDir: '../..',
  testMatch: /pocket-app\.spec\.ts/,
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
