import { defineConfig, devices } from '@playwright/test'

// Article image fixture (port 4186, storage on 4187). Serve it first:
//   bun e2e/fixtures/article-images/server.mjs
export default defineConfig({
  testDir: '../..',
  testMatch: 'article-images.spec.ts',
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4186', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
