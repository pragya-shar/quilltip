import { defineConfig, devices } from '@playwright/test'

/**
 * Sign-in suite (issue #575) against a local Convex backend. Started by
 * `bun run test:e2e:auth` (scripts/auth-e2e/run.ts), which sets the URLs.
 * Each test gets a fresh context at a phone viewport, in WebKit and Chromium.
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3125'

export default defineConfig({
  testDir: '..',
  testMatch: 'auth-return.spec.ts',
  globalSetup: '../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // One local backend serves the run, and its functions stop at 1 s. On a
  // busy machine two workers pushed sign-in past that limit.
  workers: 1,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
    { name: 'pixel-chromium', use: { ...devices['Pixel 7'] } },
  ],
})
