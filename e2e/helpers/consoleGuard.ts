import { test as base, expect } from '@playwright/test'

/**
 * Playwright `test` that fails when the page logs a console error or throws
 * an uncaught error, for the wallet fixture specs (#512). A test that expects
 * an error removes it from `consoleErrors` before it ends.
 */
/**
 * Logs the app writes on purpose for a failure it has handled and shown to
 * the reader. `TipButton` (components/tipping) logs every wallet refusal,
 * timeout or wrong network with `console.error`; the copy the reader sees is
 * asserted by each test.
 */
const HANDLED_FAILURE_LOGS = [/^Stellar tip error: WalletError: /]

export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        const text = message.text()
        if (HANDLED_FAILURE_LOGS.some((pattern) => pattern.test(text))) return
        errors.push(text)
      })
      page.on('pageerror', (error) => errors.push(`Uncaught: ${error.message}`))
      await use(errors)
      expect(errors, 'console errors on the page').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
export type { Page, BrowserContext } from '@playwright/test'
