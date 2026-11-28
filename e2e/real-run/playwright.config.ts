/**
 * Playwright cases for the guarded real run (`*.real.ts`): local only,
 * against the dev server named by `REAL_RUN_BASE_URL` and the v3 testnet
 * backend. The global setup runs the target preflight and stops on any
 * mismatch. The root config never matches these files and CI never runs
 * this config.
 *
 *   REAL_RUN_ACCOUNTS=<file> REAL_RUN_EXPECT=<env file> \
 *     npx playwright test -c e2e/real-run/playwright.config.ts
 */
import { defineConfig, devices } from '@playwright/test'

const { defaultBrowserType: _ignored, ...iphone } = devices['iPhone 13']

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.real.ts',
  globalSetup: './global-setup.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.REAL_RUN_BASE_URL ?? 'http://127.0.0.1:3240',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'phone',
      use: { ...iphone, viewport: { width: 390, height: 844 } },
    },
    {
      name: 'phone-webkit',
      use: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
    },
  ],
})
