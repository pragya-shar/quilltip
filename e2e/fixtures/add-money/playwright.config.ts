import { defineConfig, devices } from '@playwright/test'

// Add money, quick tips and turn off on an emulated wallet and network,
// port 4212 (or ADD_MONEY_FIXTURE_PORT). Serve it first:
//   bun e2e/fixtures/add-money/server.mjs
// Phones at 360, 390 and 412, with touch, in Chromium and WebKit.
const port = process.env.ADD_MONEY_FIXTURE_PORT ?? '4212'
const widths = [360, 390, 412]
const engines = [
  { name: 'chromium', device: devices['Desktop Chrome'], mobile: true },
  { name: 'webkit', device: devices['Desktop Safari'], mobile: false },
] as const

export default defineConfig({
  testDir: '../..',
  testMatch: /add-money\.spec\.ts/,
  globalSetup: '../../global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 2,
  reporter: 'list',
  timeout: 60_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: 'on-first-retry' },
  projects: engines.flatMap((engine) =>
    widths.map((width) => ({
      name: `${engine.name}-${width}`,
      use: {
        ...engine.device,
        viewport: { width, height: 800 },
        hasTouch: true,
        ...(engine.mobile ? { isMobile: true } : {}),
      },
    }))
  ),
})
