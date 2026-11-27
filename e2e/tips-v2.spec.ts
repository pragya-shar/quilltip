import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  Networks,
  TransactionBuilder,
  type Transaction,
} from '@stellar/stellar-sdk'
import {
  installVarialEmulator,
  type VarialMode,
} from './helpers/varialEmulator'

/**
 * The v2 article, highlight and basket tip flows in every state: the real
 * tip components, payment kit, runner, call encoder, wallet runtime and
 * Wallets Kit, against an emulated Varial wallet that signs with a throwaway
 * key. The fixture stands in for Convex and Stellar RPC; nothing leaves the
 * page.
 *
 *   bun e2e/fixtures/tips-v2/server.mjs
 *   TIPS_V2_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4179 bunx playwright test e2e/tips-v2.spec.ts
 *
 * Set TIPS_V2_SCREENSHOTS=<dir> to also save each state at 375, 768 and
 * 1440 px.
 */
test.skip(
  process.env.TIPS_V2_FIXTURES !== '1',
  'Start e2e/fixtures/tips-v2/server.mjs and set TIPS_V2_FIXTURES=1.'
)

const SHOTS = process.env.TIPS_V2_SCREENSHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const WIDTHS = SHOTS ? ([375, 768, 1440] as const) : ([375, 1440] as const)
const UNUSED = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

type FixtureLog = {
  prepared: Array<{ name: string; args: Record<string, unknown> }>
  submitted: Array<{ submissionId: string; txHash: string }>
  failed: Array<{ submissionId: string; reason: string; detail?: string }>
  signed: string[]
  sent: string[]
}

const log = (page: Page) =>
  page.evaluate(() => (window as unknown as { __tipsV2: FixtureLog }).__tipsV2)

async function open(
  page: Page,
  query = '',
  mode: VarialMode = 'connected'
): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(installVarialEmulator, { mode, address: UNUSED })
  await page.goto(`/?${query}`)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  return errors
}

const tipDialog = (page: Page) =>
  page.getByRole('dialog', { name: /Tip this (article|passage)/ })

async function openArticleTip(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: 'Tip article' }).click()
  const dialog = tipDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

async function chooseVarial(page: Page) {
  const picker = page.getByRole('dialog', { name: 'Choose a wallet' })
  await picker.getByRole('button', { name: /^Varial/ }).click()
  await expect(picker).toBeHidden()
}

/** Connects the emulated wallet through the gate, when the gate asks. */
async function connect(scope: Locator) {
  const page = scope.page()
  await scope.getByRole('button', { name: 'Connect wallet' }).click()
  await chooseVarial(page)
}

async function sendTip(page: Page, scope: Locator = tipDialog(page)) {
  await connect(scope)
  await scope.getByRole('button', { name: 'Send tip' }).click()
}

async function overflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    // The emulated wallet picker is the Wallets Kit's, owned elsewhere.
    .exclude('stellar-wallets-modal')
    .analyze()
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}

async function shot(page: Page, id: string, width: number) {
  if (!SHOTS) return
  await page.screenshot({
    path: path.join(SHOTS, `${id}-${width}.png`),
    fullPage: false,
    animations: 'disabled',
  })
}

/** Every visible amount and transaction link in the dialog carries the label. */
async function expectTestnetLabel(scope: Locator) {
  await expect(scope.getByText('Stellar testnet').first()).toBeVisible()
}

type State = {
  id: string
  query?: string
  mode?: VarialMode
  run: (page: Page) => Promise<Locator>
  check: (scope: Locator, page: Page) => Promise<void>
}

const STATES: State[] = [
  {
    id: 'form',
    run: openArticleTip,
    check: async (dialog) => {
      await expect(dialog.getByRole('button', { name: '$1' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(dialog.getByText('About 4 XLM')).toBeVisible()
      await expect(
        dialog.getByText('Final amount shown before you approve')
      ).toBeVisible()
      await expectTestnetLabel(dialog)
      await expect(
        dialog.locator('.pay-panel-title', { hasText: 'Connect your wallet' })
      ).toBeVisible()
    },
  },
  {
    id: 'signed-out',
    query: 'auth=out',
    run: openArticleTip,
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', { hasText: 'Sign in to continue' })
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Add to tip basket' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'no-wallet',
    mode: 'missing',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await dialog.getByRole('button', { name: 'Connect wallet' }).click()
      return dialog
    },
    check: async (dialog, page) => {
      // With no extension, the picker offers the web wallets and the
      // install links (#532); the tip dialog waits behind it.
      const picker = page.getByRole('dialog', { name: 'Choose a wallet' })
      await expect(
        picker.getByRole('region', { name: 'No install needed' })
      ).toBeVisible()
      await expect(picker.getByRole('button', { name: /^xBull/ })).toBeVisible()
      await expect(
        picker.getByRole('link', { name: /Get Varial/ })
      ).toBeVisible()
      await expect(dialog).toHaveAttribute('data-state', 'open')
    },
  },
  {
    id: 'locked',
    mode: 'locked',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await connect(dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', { hasText: 'Your wallet is locked' })
      ).toBeVisible()
    },
  },
  {
    id: 'wrong-network',
    mode: 'wrong-network',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await connect(dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'Switch your wallet to Testnet',
        })
      ).toBeVisible()
      await expect(
        dialog.locator('.pay-panel').getByText(/Switch it to Testnet/)
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Check again' })
      ).toBeVisible()
    },
  },
  {
    id: 'unverified',
    query: 'link=unverified',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await connect(dialog)
      return dialog
    },
    check: async (dialog, page) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'Confirm this wallet is yours',
        })
      ).toBeVisible()
      await dialog.getByRole('button', { name: 'Confirm wallet' }).click()
      await expect(
        dialog.getByRole('button', { name: 'Send tip' })
      ).toBeFocused()
      expect((await log(page)).prepared).toEqual([])
    },
  },
  {
    id: 'insufficient-balance',
    query: 'sim=balance',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog, page) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'Not enough XLM in your wallet',
        })
      ).toBeVisible()
      await expect(
        dialog.locator('.pay-panel').getByText(/Your wallet can spend 2 XLM/)
      ).toBeVisible()
      await expectTestnetLabel(dialog)
      expect((await log(page)).failed).toEqual([
        expect.objectContaining({
          reason: 'simulation_failed',
          detail: 'BalanceError',
        }),
      ])
      // The form stays, so the reader can choose less.
      await expect(dialog.getByRole('button', { name: '$2' })).toBeVisible()
    },
  },
  {
    id: 'below-minimum',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await dialog.getByLabel('Other amount').fill('0.01')
      await dialog.getByRole('button', { name: 'Add to tip basket' }).click()
      return dialog
    },
    check: async (dialog, page) => {
      const input = dialog.getByLabel('Other amount')
      await expect(input).toHaveAttribute('aria-invalid', 'true')
      await expect(
        dialog.getByText('The smallest tip right now is $0.03.')
      ).toBeVisible()
      await expect(input).toBeFocused()
      expect((await log(page)).prepared).toEqual([])
    },
  },
  {
    id: 'below-minimum-server',
    query: 'prepare=below',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'This tip is below the minimum',
        })
      ).toBeVisible()
      await expect(
        dialog.getByText(/smallest tip right now is \$0\.03/)
      ).toBeVisible()
    },
  },
  {
    id: 'price-unavailable',
    query: 'article=price',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await connect(dialog)
      return dialog
    },
    check: async (dialog, page) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'No XLM price right now',
        })
      ).toBeVisible()
      const send = dialog.getByRole('button', { name: 'Send tip' })
      await expect(send).toHaveAttribute('aria-disabled', 'true')
      await send.click({ force: true })
      expect((await log(page)).prepared).toEqual([])
    },
  },
  {
    id: 'rate-limited',
    query: 'prepare=rate',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'Too many tips in a short time',
        })
      ).toBeVisible()
      await expect(dialog.getByText(/Wait 42 seconds/)).toBeVisible()
    },
  },
  {
    id: 'not-registered',
    query: 'article=unregistered',
    run: async (page) => page.locator('.reader-support'),
    check: async (scope) => {
      await expect(
        scope.getByText('Tips aren’t on for this article yet.')
      ).toBeVisible()
      await expect(
        scope.getByRole('button', { name: 'Tip article' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'registration-pending',
    query: 'article=pending',
    run: async (page) => page.locator('.reader-support'),
    check: async (scope) => {
      await expect(
        scope.getByText('Tips for this article turn on in a moment.')
      ).toBeVisible()
    },
  },
  {
    id: 'writer-without-payout-address',
    query: 'article=payout',
    run: async (page) => page.locator('.reader-support'),
    check: async (scope) => {
      await expect(
        scope.getByText(
          'Tips are paused while the writer updates their wallet.'
        )
      ).toBeVisible()
    },
  },
  {
    id: 'v1-tips-paused',
    query: 'article=v1-paused',
    run: async (page) => page.locator('main'),
    check: async (scope) => {
      // Before v2 is on, v1 preparation is paused (#520): a note replaces
      // both tip buttons, and no basket appears.
      await expect(
        scope
          .locator('.reader-support')
          .getByText(
            'Tips are paused for a short time while payments are updated.'
          )
      ).toBeVisible()
      await expect(
        scope.getByText(
          'Tips are paused for a short time while payments are updated.'
        )
      ).toHaveCount(2)
      await expect(
        scope.getByRole('button', { name: /Tip (article|passage)/ })
      ).toHaveCount(0)
      await expect(
        scope.page().getByRole('button', { name: /Tip basket/ })
      ).toHaveCount(0)
    },
  },
  {
    id: 'own-article',
    query: 'article=own',
    run: async (page) => page.locator('main'),
    check: async (scope) => {
      await expect(
        scope.getByRole('button', { name: 'Tip article' })
      ).toHaveCount(0)
      await expect(
        scope.getByRole('button', { name: 'Tip passage' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'paused',
    query: 'article=paused',
    run: openArticleTip,
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', { hasText: 'Payments are paused' })
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Send tip' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'paused-on-chain',
    query: 'sim=paused',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', { hasText: 'Payments are paused' })
      ).toBeVisible()
    },
  },
  {
    id: 'v2-disabled',
    query: 'v2=off',
    run: async (page) => page.locator('.reader-support'),
    check: async (scope) => {
      // The v1 flow renders unchanged; no basket.
      await expect(
        scope.getByRole('button', { name: 'Tip article' })
      ).toBeVisible()
      await expect(
        scope.page().getByRole('button', { name: /Tip basket/ })
      ).toHaveCount(0)
    },
  },
  {
    id: 'v2-disabled-at-prepare',
    query: 'prepare=v2off',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'Tips on Stellar testnet are not on here',
        })
      ).toBeVisible()
    },
  },
  {
    id: 'pending-prepare',
    query: 'sim=slow',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-progress-sentence', {
          hasText: 'Checking the details…',
        })
      ).toBeVisible()
      await expect(
        dialog.getByRole('listitem').filter({ hasText: 'Prepare' })
      ).toHaveAttribute('aria-current', 'step')
    },
  },
  {
    id: 'pending-wallet',
    mode: 'timeout-sign',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-progress-sentence', {
          hasText:
            'Approve the request in your wallet. It shows the network fee.',
        })
      ).toBeVisible()
      await expect(
        dialog.getByText('Don’t see the request? Open your wallet extension.')
      ).toBeVisible()
      await expect(dialog).toHaveAttribute('aria-busy', 'true')
      // A wallet step is running: neither Escape nor a click outside closes
      // the dialog. Each check waits past the close animation (200 ms).
      const page = dialog.page()
      await page.keyboard.press('Escape')
      await page.waitForTimeout(500)
      await expect(dialog).toHaveAttribute('data-state', 'open')
      await page.mouse.click(4, 4)
      await page.waitForTimeout(500)
      await expect(dialog).toHaveAttribute('data-state', 'open')
    },
  },
  {
    id: 'pending-send',
    query: 'send=slow',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-progress-sentence', { hasText: 'Sending…' })
      ).toBeVisible()
    },
  },
  {
    id: 'pending-checking',
    query: 'result=never',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog, page) => {
      await expect(
        dialog.locator('.pay-progress-sentence', {
          hasText: /Waiting for confirmation\. You can close this/,
        })
      ).toBeVisible()
      await expect(
        dialog.getByRole('link', { name: /View the transaction/ })
      ).toBeVisible()
      await expectTestnetLabel(dialog)
      const entry = await log(page)
      expect(entry.submitted).toHaveLength(1)
      expect(entry.submitted[0]!.txHash).toBe(entry.sent[0])
    },
  },
  {
    id: 'declined',
    mode: 'reject-sign',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog, page) => {
      await expect(
        dialog.getByRole('heading', { name: 'Request declined in your wallet' })
      ).toBeVisible()
      await expect(
        dialog.getByText('Nothing was signed or sent.')
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toBeVisible()
      expect((await log(page)).failed).toEqual([
        expect.objectContaining({
          reason: 'wallet_rejected',
          detail: 'rejected',
        }),
      ])
    },
  },
  {
    id: 'send-error',
    query: 'send=error',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog, page) => {
      await expect(
        dialog.getByRole('heading', { name: 'Not sent' })
      ).toBeVisible()
      await expect(
        dialog.locator('.pay-panel').getByText(/Nothing was (paid|sent)\./)
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toBeVisible()
      expect((await log(page)).failed[0]).toMatchObject({
        reason: 'send_error',
      })
    },
  },
  {
    id: 'network-busy',
    query: 'send=busy',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-panel-title', {
          hasText: 'Stellar testnet is busy',
        })
      ).toBeVisible({ timeout: 20_000 })
    },
  },
  {
    id: 'expired',
    query: 'result=expired',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.getByRole('heading', { name: 'This request timed out' })
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toBeVisible()
    },
  },
  {
    id: 'confirmed',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog, page) => {
      const title = dialog.getByRole('heading', { name: 'Tip confirmed' })
      await expect(title).toBeVisible()
      await expect(title).toBeFocused()
      // 97.5% of 4 XLM, from the chain values, to the author.
      await expect(dialog.getByText('3.9 XLM to Ada Lovelace')).toBeVisible()
      await expectTestnetLabel(dialog)
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toHaveCount(0)
      const entry = await log(page)
      expect(entry.prepared.map((p) => p.name)).toEqual([
        'tipsV2.prepareDirectTip',
      ])
      expect(entry.signed).toHaveLength(1)
      const tx = TransactionBuilder.fromXDR(
        entry.signed[0]!,
        Networks.TESTNET
      ) as Transaction
      const fn = (
        tx.operations[0] as unknown as {
          func: { invokeContract: { functionName: { toString(): string } } }
        }
      ).func.invokeContract.functionName.toString()
      expect(fn).toBe('tip')
      expect(tx.timeBounds?.minTime).toBe('0')
    },
  },
  {
    id: 'sent-to-registered-author',
    query: 'result=author',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.getByRole('heading', {
          name: 'Tip sent to the article’s registered payout address',
        })
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'under-review',
    query: 'result=review',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.getByRole('heading', { name: 'Sent, but under review' })
      ).toBeVisible()
      await expect(dialog.getByText(/Reference/)).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'under-review-after-failure',
    query: 'result=late-event',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog) => {
      // The server flagged a FAILED record: money may have moved.
      await expect(
        dialog.getByRole('heading', { name: 'Sent, but under review' })
      ).toBeVisible()
      await expect(dialog.getByText(/Nothing was paid/)).toHaveCount(0)
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'reload-prepared',
    query: 'reload=prepared',
    run: async (page) => {
      await expect(
        page.getByText('Your last tip is being checked.')
      ).toBeVisible()
      await page.getByRole('button', { name: 'View your last tip' }).click()
      return tipDialog(page)
    },
    check: async (dialog) => {
      await expect(
        dialog.getByText(/Checking whether this payment went through/)
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'reload-sent',
    query: 'reload=prepared-hash',
    run: async (page) => {
      await page.getByRole('button', { name: 'View your last tip' }).click()
      return tipDialog(page)
    },
    check: async (dialog, page) => {
      await expect(
        dialog.getByRole('heading', { name: 'Tip confirmed' })
      ).toBeVisible()
      // The stored hash was recorded again; nothing was signed again.
      const entry = await log(page)
      expect(entry.submitted).toEqual([
        { submissionId: 'sub-reload', txHash: 'b8'.repeat(32) },
      ])
      expect(entry.signed).toEqual([])
    },
  },
  {
    id: 'reload-checking',
    query: 'reload=submitted',
    run: async (page) => {
      await page.getByRole('button', { name: 'View your last tip' }).click()
      return tipDialog(page)
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-progress-sentence', {
          hasText: /Waiting for confirmation/,
        })
      ).toBeVisible()
    },
  },
  {
    id: 'pending-slow',
    query: 'reload=slow',
    run: async (page) => {
      await page.getByRole('button', { name: 'View your last tip' }).click()
      return tipDialog(page)
    },
    check: async (dialog) => {
      await expect(
        dialog.locator('.pay-progress-sentence', { hasText: /Still checking/ })
      ).toBeVisible()
      await expect(
        dialog.getByText(/cannot be charged twice/).first()
      ).toBeVisible()
      await expect(
        dialog.getByRole('button', { name: 'Try again' })
      ).toHaveCount(0)
    },
  },
  {
    id: 'highlight-confirmed',
    run: async (page) => {
      await page.getByRole('button', { name: 'Tip passage' }).click()
      const dialog = page.getByRole('dialog', { name: 'Tip this passage' })
      await sendTip(page, dialog)
      return dialog
    },
    check: async (dialog, page) => {
      await expect(
        dialog.getByRole('heading', { name: 'Highlight tip confirmed' })
      ).toBeVisible()
      const entry = await log(page)
      expect(entry.prepared[0]!.name).toBe('tipsV2.prepareHighlightTip')
      expect(entry.prepared[0]!.args.highlight).toMatchObject({
        text: 'The quick brown fox jumps over the lazy dog',
      })
    },
  },
  {
    id: 'basket-review',
    query: 'basket=2',
    run: async (page) => {
      await page.getByRole('button', { name: /Tip basket/ }).click()
      return page.getByRole('dialog', { name: 'Tip basket' })
    },
    check: async (sheet) => {
      await expect(sheet.getByRole('list', { name: 'Tips' })).toBeVisible()
      await expect(
        sheet.getByText('2 of 10 tips · 8 of 24 transfers')
      ).toBeVisible()
      await expect(sheet.getByText(/^About/).first()).toBeVisible()
      await expectTestnetLabel(sheet)
    },
  },
  {
    id: 'basket-confirmed',
    query: 'basket=2',
    run: async (page) => {
      await page.getByRole('button', { name: /Tip basket/ }).click()
      const sheet = page.getByRole('dialog', { name: 'Tip basket' })
      await connect(sheet)
      await sheet.getByRole('button', { name: /^Send 2 tips/ }).click()
      return sheet
    },
    check: async (sheet, page) => {
      await expect(
        sheet.getByRole('heading', { name: /Tips confirmed/ })
      ).toBeVisible()
      // $1.00 + $1.25 at $0.25 is 9 XLM gross. The fee is
      // floor(90,000,000 × 250 / 10,000) stroops: 0.225 XLM, so the writers
      // get 8.775 XLM. Both figures come from the chain totals.
      const line = (label: string) =>
        sheet.locator('.pay-amount-breakdown > div', {
          has: page.getByText(label, { exact: true }),
        })
      await expect(line('To the writers')).toContainText('8.775')
      await expect(line('Platform fee')).toContainText('0.225')
      await expectTestnetLabel(sheet)
    },
  },
  {
    id: 'basket-confirmed-one-in-review',
    query: 'basket=3&result=batch-review',
    run: async (page) => {
      await page.getByRole('button', { name: /Tip basket/ }).click()
      const sheet = page.getByRole('dialog', { name: 'Tip basket' })
      await connect(sheet)
      await sheet.getByRole('button', { name: /^Send 3 tips/ }).click()
      return sheet
    },
    check: async (sheet, page) => {
      await expect(
        sheet.getByRole('heading', { name: 'Sent, but under review' })
      ).toBeVisible()
      const rows = sheet.getByRole('list', { name: 'Tips in this payment' })
      await expect(rows.getByText('Confirmed', { exact: true })).toHaveCount(2)
      await expect(rows.getByText('Under review', { exact: true })).toHaveCount(
        1
      )
      await expect(
        sheet.getByRole('button', { name: 'Try again' })
      ).toHaveCount(0)
      const entry = await log(page)
      expect(entry.prepared[0]!.name).toBe('tipsV2.prepareBatch')
      expect(entry.signed).toHaveLength(1)
    },
  },
  {
    id: 'basket-item-unavailable',
    query: 'basket=3&prepare=item',
    run: async (page) => {
      await page.getByRole('button', { name: /Tip basket/ }).click()
      const sheet = page.getByRole('dialog', { name: 'Tip basket' })
      await connect(sheet)
      await sheet.getByRole('button', { name: /^Send 3 tips/ }).click()
      return sheet
    },
    check: async (sheet) => {
      await expect(
        sheet.locator('.pay-panel-title', {
          hasText: 'An article in your basket can’t take tips right now',
        })
      ).toBeVisible()
      await expect(
        sheet.getByText('Can’t take tips right now', { exact: true })
      ).toHaveCount(1)
      await sheet.getByRole('button', { name: 'Remove it' }).click()
      await expect(
        sheet.getByText('2 of 10 tips', { exact: false })
      ).toBeVisible()
    },
  },
  {
    id: 'basket-full',
    query: 'basket=full',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await dialog.getByRole('button', { name: 'Add to tip basket' }).click()
      return dialog
    },
    check: async (dialog) => {
      await expect(dialog.getByText(/Your basket is full\./)).toBeVisible()
    },
  },
  {
    id: 'basket-no-transfers-left',
    query: 'basket=transfers',
    run: async (page) => {
      const dialog = await openArticleTip(page)
      await dialog.getByRole('button', { name: 'Add to tip basket' }).click()
      return dialog
    },
    check: async (dialog) => {
      await expect(
        dialog.getByText(/It needs 2 transfers and 0 are left of 24/)
      ).toBeVisible()
    },
  },
]

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    for (const state of STATES) {
      test(state.id, async ({ page }) => {
        const errors = await open(page, state.query, state.mode)
        const scope = await state.run(page)
        await state.check(scope, page)
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        expect(await axe(page)).toEqual([])
        await shot(page, state.id, width)
        expect(errors).toEqual([])
      })
    }
  })
}

test.describe('keyboard, focus and announcements', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a tip runs from the keyboard alone', async ({ page }) => {
    await open(page)
    const trigger = page.getByRole('button', { name: 'Tip article' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = tipDialog(page)
    await expect(dialog).toBeVisible()
    // Choose $2 with Tab and Space.
    const two = dialog.getByRole('button', { name: '$2' })
    for (
      let i = 0;
      i < 8 && !(await two.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab')
    }
    await page.keyboard.press('Space')
    await expect(two).toHaveAttribute('aria-pressed', 'true')
    // Connect through the gate and the wallet picker.
    const connectButton = dialog.getByRole('button', { name: 'Connect wallet' })
    await connectButton.focus()
    await page.keyboard.press('Enter')
    const varial = page
      .getByRole('dialog', { name: 'Choose a wallet' })
      .getByRole('button', { name: /^Varial/ })
    await expect(varial).toBeVisible()
    for (
      let i = 0;
      i < 8 && !(await varial.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab')
    }
    await page.keyboard.press('Enter')
    // The gate hands focus to the action it was guarding.
    const send = dialog.getByRole('button', { name: 'Send tip' })
    await expect(send).toBeFocused()
    await page.keyboard.press('Enter')
    const result = dialog.getByRole('heading', { name: 'Tip confirmed' })
    await expect(result).toBeFocused()
    // The explorer link is reachable by Tab from the result.
    const link = dialog.getByRole('link', { name: /View the transaction/ })
    for (
      let i = 0;
      i < 4 && !(await link.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab')
    }
    await expect(link).toBeFocused()
    // Done closes the dialog and returns focus to the trigger.
    await dialog.getByRole('button', { name: 'Done' }).focus()
    await page.keyboard.press('Enter')
    await expect(dialog).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('the amount field is labelled, validated on submit and linked to its error', async ({
    page,
  }) => {
    await open(page)
    const dialog = await openArticleTip(page)
    const input = dialog.getByLabel('Other amount')
    await input.fill('abc')
    await input.press('Enter')
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = await input.getAttribute('aria-describedby')
    const ids = describedBy!.split(' ')
    await expect(page.locator(`[id="${ids[0]}"]`)).toHaveText(
      'Enter an amount in dollars, for example 1.50.'
    )
    // Fixing it clears the error at once.
    await input.fill('1.50')
    await expect(input).not.toHaveAttribute('aria-invalid', 'true')
    expect(
      await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    ).toBeGreaterThanOrEqual(16)
  })

  test('"Added to your tip basket" is announced, and the basket opens', async ({
    page,
  }) => {
    await open(page)
    const dialog = await openArticleTip(page)
    const region = dialog.locator('.tip-v2-added[role="status"]')
    await expect(region).toHaveText('')
    await dialog.getByRole('button', { name: 'Add to tip basket' }).click()
    await expect(region).toContainText('Added to your tip basket')
    await dialog.getByRole('button', { name: 'Open basket' }).click()
    const sheet = page.getByRole('dialog', { name: 'Tip basket' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('list', { name: 'Tips' })).toContainText(
      'On Writing Well, Again'
    )
    // Remove keeps focus in the basket.
    await sheet.getByRole('button', { name: /Remove the tip for/ }).click()
    await expect(sheet.getByText(/Your tip basket is empty/)).toBeVisible()
  })

  test('focus follows the payment; a focused title is not announced twice', async ({
    page,
  }) => {
    await open(page, 'result=never', 'connected')
    const dialog = await openArticleTip(page)
    await sendTip(page, dialog)
    // While it runs, the hidden progress heading holds focus.
    await expect(
      dialog.getByRole('heading', { name: 'Payment progress' })
    ).toBeFocused()
    await expect(
      dialog.locator('.pay-progress-sentence', {
        hasText: /Waiting for confirmation/,
      })
    ).toBeVisible()
  })

  test('a refusal takes focus on its title and is not read twice', async ({
    page,
  }) => {
    await open(page, '', 'reject-sign')
    const dialog = await openArticleTip(page)
    await sendTip(page, dialog)
    const title = dialog.getByRole('heading', {
      name: 'Request declined in your wallet',
    })
    await expect(title).toBeFocused()
    await expect(dialog.locator('.pay-progress [role="alert"]')).toHaveText('')
  })

  test('the basket button is in the tab order after the tip button', async ({
    page,
  }) => {
    await open(page, 'basket=2')
    const trigger = page.getByRole('button', { name: 'Tip article' })
    const basket = page.getByRole('button', { name: 'Tip basket, 2 tips' })
    await expect(basket).toBeVisible()
    await trigger.focus()
    await page.keyboard.press('Tab')
    await expect(basket).toBeFocused()
    const box = await basket.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    await page.keyboard.press('Enter')
    await expect(page.getByRole('dialog', { name: 'Tip basket' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(basket).toBeFocused()
  })
})

const basketKeys = (page: Page) =>
  page.evaluate(() =>
    Object.keys(localStorage).filter((key) =>
      key.startsWith('quilltip:tip-basket:v2:')
    )
  )

test.describe('one payment per activation', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('two activations of Send tip in one task prepare and sign once', async ({
    page,
  }) => {
    await open(page)
    const dialog = await openArticleTip(page)
    await connect(dialog)
    // Both clicks run before React renders again, as some assistive tools
    // and test drivers fire them.
    await dialog
      .getByRole('button', { name: 'Send tip' })
      .evaluate((button: HTMLButtonElement) => {
        button.click()
        button.click()
      })
    await expect(
      dialog.getByRole('heading', { name: 'Tip confirmed' })
    ).toBeVisible()
    const entry = await log(page)
    expect(entry.prepared).toHaveLength(1)
    expect(entry.signed).toHaveLength(1)
    expect(entry.sent).toHaveLength(1)
    expect(entry.submitted).toHaveLength(1)
  })

  test('two activations of the basket payment in one task pay once', async ({
    page,
  }) => {
    await open(page, 'basket=2')
    await page.getByRole('button', { name: /Tip basket/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Tip basket' })
    await connect(sheet)
    await sheet
      .getByRole('button', { name: /^Send 2 tips/ })
      .evaluate((button: HTMLButtonElement) => {
        button.click()
        button.click()
      })
    await expect(
      sheet.getByRole('heading', { name: /Tips confirmed/ })
    ).toBeVisible()
    const entry = await log(page)
    expect(entry.prepared).toHaveLength(1)
    expect(entry.signed).toHaveLength(1)
    expect(entry.sent).toHaveLength(1)
  })

  test('tips sent under review leave the basket on Done', async ({ page }) => {
    await open(page, 'basket=3&result=batch-review')
    await page.getByRole('button', { name: /Tip basket/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Tip basket' })
    await connect(sheet)
    await sheet.getByRole('button', { name: /^Send 3 tips/ }).click()
    await expect(
      sheet.getByRole('heading', { name: 'Sent, but under review' })
    ).toBeVisible()
    expect(await basketKeys(page)).toHaveLength(1)
    await sheet.getByRole('button', { name: 'Done' }).click()
    // Money may have moved, so none of the three can be sent again.
    await expect(page.getByRole('button', { name: /Tip basket/ })).toHaveCount(
      0
    )
    expect(await basketKeys(page)).toEqual([])
    await page.reload()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: /Tip basket/ })).toHaveCount(
      0
    )
  })
})

test.describe('small screens', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the basket is a bottom sheet clear of the home indicator', async ({
    page,
  }) => {
    await open(page, 'basket=2')
    await page.getByRole('button', { name: /Tip basket/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Tip basket' })
    await expect(sheet).toHaveAttribute('data-side', 'bottom')
    // Let the slide-in finish before measuring.
    await sheet.evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished))
    )
    const box = await sheet.boundingBox()
    expect(Math.round(box!.y + box!.height)).toBe(812)
    expect(box!.height).toBeLessThanOrEqual(812 * 0.85 + 1)
  })

  test('the basket button spans the screen with 16 px gutters', async ({
    page,
  }) => {
    await open(page, 'basket=1')
    const box = await page
      .getByRole('button', { name: /Tip basket/ })
      .boundingBox()
    expect(Math.round(box!.x)).toBe(16)
    expect(Math.round(box!.width)).toBe(375 - 32)
  })
})

test.describe('reflow at 320 px (400 % zoom of 1280)', () => {
  test.use({ viewport: { width: 320, height: 640 } })

  test('the dialog and the basket fit without sideways scrolling', async ({
    page,
  }) => {
    await open(page, 'basket=transfers')
    const dialog = await openArticleTip(page)
    await dialog.getByLabel('Other amount').fill('12345.67')
    await dialog.getByRole('button', { name: 'Add to tip basket' }).click()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    const box = await dialog.boundingBox()
    expect(box!.width).toBeLessThanOrEqual(320)
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: /Tip basket/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Tip basket' })
    await expect(sheet.getByRole('list', { name: 'Tips' })).toBeVisible()
    expect(await overflow(page)).toBeLessThanOrEqual(0)
    expect(await axe(page)).toEqual([])
  })
})

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })

  test('the dialog, sheet and result do not animate', async ({ page }) => {
    await open(page, 'basket=1')
    const dialog = await openArticleTip(page)
    await sendTip(page, dialog)
    await expect(
      dialog.getByRole('heading', { name: 'Tip confirmed' })
    ).toBeVisible()
    const animated = await page.evaluate(
      () =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '.tip-dialog, .tip-dialog *, .tip-basket-button'
          ),
        ].filter((el) => {
          const style = getComputedStyle(el)
          return (
            (style.animationName !== 'none' &&
              parseFloat(style.animationDuration) > 0) ||
            parseFloat(style.transitionDuration) > 0
          )
        }).length
    )
    expect(animated).toBe(0)
  })
})

for (const width of [320, 1440] as const) {
  test.describe(`worst-case data at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } })

    for (const dir of ['ltr', 'rtl'] as const) {
      test(`long, unbroken and non-Latin text holds up (${dir})`, async ({
        page,
      }) => {
        const errors = await open(page, `data=worst&basket=full&dir=${dir}`)
        await page.getByRole('button', { name: 'Tip passage' }).click()
        const dialog = page.getByRole('dialog', { name: 'Tip this passage' })
        await expect(dialog).toBeVisible()
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        expect(await axe(page)).toEqual([])
        await shot(page, `worst-dialog-${dir}`, width)
        await page.keyboard.press('Escape')
        await page.getByRole('button', { name: /Tip basket, 10 tips/ }).click()
        const sheet = page.getByRole('dialog', { name: 'Tip basket' })
        await expect(sheet.getByRole('listitem')).toHaveCount(10)
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        // Every Remove control stays inside the sheet.
        const sheetBox = (await sheet.boundingBox())!
        for (const remove of await sheet
          .getByRole('button', { name: /^Remove the tip/ })
          .all()) {
          const box = (await remove.boundingBox())!
          expect(box.x).toBeGreaterThanOrEqual(sheetBox.x)
          expect(box.x + box.width).toBeLessThanOrEqual(
            sheetBox.x + sheetBox.width + 0.5
          )
        }
        expect(await axe(page)).toEqual([])
        await shot(page, `worst-basket-${dir}`, width)
        expect(errors).toEqual([])
      })
    }
  })
}
