import { defineConfig, devices } from '@playwright/test'

// Tab UI fixtures (port 4183), and the tip dialog's tab section on /dialog
// (#546). Serve them first:
//   bun e2e/fixtures/tab-ui/server.mjs
// Chromium runs every state and flow; Firefox and WebKit run the session-key
// and voucher paths, where the engines differ. WebKit also runs the tab tip's
// keyboard and focus tests, the refusal focus tests and the presses under
// the amount field (#658), where Safari's focus differs.
export default defineConfig({
  testDir: '../..',
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: 'list',
  timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:4183', trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      testMatch: /(tab-ui(-keys)?|tab-tip-dialog)\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      testMatch: /tab-ui-keys\.spec\.ts/,
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      testMatch: /tab-ui-keys\.spec\.ts/,
      use: { ...devices['Desktop Safari'] },
    },
    {
      name: 'webkit-focus',
      testMatch: /(tab-tip-dialog|tab-ui)\.spec\.ts/,
      grep: /keyboard and screen readers|refusal focus|dialog at its full height|at 320 px without a tab/,
      use: { ...devices['Desktop Safari'] },
    },
  ],
})
