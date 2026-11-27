import type { AppCheck } from './types'

/** The shell's own production-build checks. */
export const checks: readonly AppCheck[] = [
  {
    // Public reading with JavaScript off (D19), Chromium and WebKit.
    name: 'reading without scripts',
    command: [
      'bunx',
      'playwright',
      'test',
      '--config',
      'e2e/fixtures/system/no-script.config.ts',
    ],
  },
  {
    // Crossing from the legacy pages: the stored theme and the balance
    // item before paint, under the CSP, Chromium and WebKit.
    name: 'crossing into the shell',
    command: [
      'bunx',
      'playwright',
      'test',
      '--config',
      'e2e/fixtures/system/crossing.config.ts',
    ],
  },
]
