import { defineConfig, devices } from '@playwright/test'

// The tab session-key suite runs in all three engines: key storage and
// WebCrypto Ed25519 differ between them. Serve the fixture first
// (`bun e2e/fixtures/tab/server.mjs`, port 4181).
export default defineConfig({
  testDir: '../..',
  testMatch: 'tab-session-keys.spec.ts',
  globalSetup: '../../global-setup.ts',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4181', trace: 'on-first-retry' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
})
