import { defineConfig, devices } from '@playwright/test'

// v2 tip fixtures (port 4179). Serve them first:
//   bun e2e/fixtures/tips-v2/server.mjs
// Chromium runs every state and flow. WebKit runs the keyboard and focus
// tests, the dialog and refusal focus tests and the result states, where
// Safari's focus and Tab order differ.
export default defineConfig({
  testDir: '../..',
  testMatch: 'tips-v2.spec.ts',
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4179', trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      grep: /keyboard, focus and announcements|dialog focus|refusal focus|px (confirmed|declined|basket-confirmed)$/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
