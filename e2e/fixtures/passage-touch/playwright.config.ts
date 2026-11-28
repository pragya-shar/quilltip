import { defineConfig, devices } from '@playwright/test'

// Passage selection on a touch screen (#665), port 4192. Serve it first:
//   bun e2e/fixtures/passage-touch/server.mjs
// Chromium (Pixel 5) and WebKit (iPhone 13), both with touch.
export default defineConfig({
  testDir: '../..',
  testMatch: 'touch-passage-offer.spec.ts',
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4192', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 5'] } },
    { name: 'webkit', use: { ...devices['iPhone 13'] } },
  ],
})
