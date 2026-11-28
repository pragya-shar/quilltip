import { defineConfig, devices } from '@playwright/test'

// The v2 tip fixture built with code splitting (server-split.mjs, port
// 4191), so the tip form loads as its own chunk, as in the app (#669).
export default defineConfig({
  testDir: '../..',
  testMatch: 'tip-code-load.spec.ts',
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4191' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
