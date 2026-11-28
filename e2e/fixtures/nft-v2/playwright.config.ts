import { defineConfig, devices } from '@playwright/test'

// v2 NFT fixtures (port 4182). Serve them first:
//   NFT_V2_FIXTURES=1 bun e2e/fixtures/nft-v2/server.mjs
// Chromium runs every state and flow. WebKit runs the check that the
// recipient error does not move the footer buttons, where a press missed
// in Safari (#658).
export default defineConfig({
  testDir: '../..',
  testMatch: 'nft-v2.spec.ts',
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4182',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    {
      name: 'webkit',
      grep: /does not move Cancel or Review transfer/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
