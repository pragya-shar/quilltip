import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { STATES } from './fixtures/payments/states'
import {
  ESTIMATE,
  TESTNET_LABEL_DETAIL,
  quoteCopy,
} from '../lib/copy/payment-states'
import { SETTLE_MS } from '../components/payments/useAnnouncement'
import { contrastScan, surfaceColours } from './helpers/lightSurface'

/**
 * The shared payment kit (components/payments) in every state, against the
 * fixture page. Nothing reaches a wallet, Convex or the network.
 *
 *   bun e2e/fixtures/payments/server.mjs
 *   PAYMENT_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4180 bunx playwright test e2e/payment-states.spec.ts
 *
 * Set PAYMENT_SCREENSHOTS=<dir> to also save one screenshot per state and width.
 */
test.skip(
  process.env.PAYMENT_FIXTURES !== '1',
  'Start e2e/fixtures/payments/server.mjs and set PAYMENT_FIXTURES=1.'
)

const WIDTHS = [375, 768, 1440] as const
const SHOTS = process.env.PAYMENT_SCREENSHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

type Calls = { __calls?: string[] }

async function open(page: Page, id: string, query = '') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`/?state=${id}${query}`)
  await expect(page.locator('[aria-label="Fixture"]')).toBeVisible()
  return errors
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement
    return root.scrollWidth - root.clientWidth
  })
}

async function axe(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`
  )
}

function polite(page: Page) {
  return page.locator('.pay-progress [role="status"][aria-live="polite"]')
}
function assertive(page: Page) {
  return page.locator('.pay-progress [role="alert"]')
}

for (const width of WIDTHS) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const state of STATES) {
      test(`${state.id} renders, fits and passes the scan`, async ({
        page,
      }) => {
        const errors = await open(page, state.id)
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
        expect(await axe(page)).toEqual([])
        if (SHOTS) {
          await page.screenshot({
            path: path.join(SHOTS, `${state.id}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          })
        }
        expect(errors).toEqual([])
      })
    }
  })
}

const RETRYABLE = new Set([
  'result-failed',
  'result-declined',
  'result-failed-wallet',
  'result-failed-popup',
  'result-failed-long',
  'result-failed-busy',
  'result-expired',
  'result-tab-op-failed',
  'result-tab-op-failed-busy',
  'result-tab-op-expired',
  'result-tab-op-expired-with-failure',
])

test.describe('retry rule', () => {
  for (const state of STATES.filter(
    (entry) => entry.group === 'result' || entry.group === 'progress'
  )) {
    const retryable = RETRYABLE.has(state.id)
    test(`${state.id} ${retryable ? 'offers' : 'never offers'} a retry`, async ({
      page,
    }) => {
      await open(page, state.id)
      const retry = page.getByRole('button', { name: 'Try again' })
      if (retryable) await expect(retry).toBeVisible()
      else await expect(retry).toHaveCount(0)
    })
  }

  test('a payment sent to the registered address says so and has no retry', async ({
    page,
  }) => {
    await open(page, 'result-sent-to-registered')
    await expect(
      page.getByRole('heading', {
        name: 'Tip sent to the article’s registered payout address',
      })
    ).toBeVisible()
    await expect(page.locator('.pay-panel-detail')).toContainText(
      'there is nothing to retry'
    )
    await expect(page.getByRole('button')).toHaveCount(0)
  })

  test('an unknown status is safe: checking, no retry, not confirmed', async ({
    page,
  }) => {
    await open(page, 'progress-unknown-status')
    await expect(page.locator('.pay-progress')).toHaveAttribute(
      'data-phase',
      'resuming'
    )
    await expect(page.locator('.pay-inline-status')).toHaveText(
      'Checking whether this payment went through. This can take several minutes. If it did not go through, you can try again when the check ends.'
    )
    await expect(page.locator('.pay-steps')).toHaveCount(0)
  })

  test('a tab operation shows the failure its flow passes, not the polling copy', async ({
    page,
  }) => {
    await open(page, 'result-tab-op-failed-busy')
    await expect(
      page.getByRole('heading', { name: 'Stellar testnet is busy' })
    ).toBeVisible()
    await expect(page.locator('.pay-panel-detail')).toContainText(
      'Stellar testnet did not accept it.'
    )
    await expect(page.locator('.pay-progress')).not.toContainText(
      'reported this transaction as failed'
    )

    await open(page, 'result-tab-op-failed')
    await expect(
      page.getByRole('heading', { name: 'Not completed' })
    ).toBeVisible()
    await expect(page.locator('.pay-panel-detail')).toContainText(
      'Stellar testnet reported this transaction as failed.'
    )
  })

  test('an expired tab operation keeps its own copy when the flow passes a failure', async ({
    page,
  }) => {
    await open(page, 'result-tab-op-expired-with-failure')
    await expect(
      page.getByRole('heading', { name: 'This request timed out' })
    ).toBeVisible()
    await expect(page.locator('.pay-panel-detail')).toContainText(
      'Check your tab before you try again.'
    )
    // Neither the flow's failure nor the record copy, which speaks about
    // payment from server data that a tab operation does not have.
    await expect(page.locator('.pay-progress')).not.toContainText(
      'Stellar testnet is busy'
    )
    await expect(page.locator('.pay-progress')).not.toContainText(
      'nothing was paid'
    )
  })

  test('a blocked wallet window says how to allow it, then offers a retry', async ({
    page,
  }) => {
    await open(page, 'result-failed-popup')
    await expect(
      page.getByRole('heading', {
        name: 'Your browser blocked the wallet window',
      })
    ).toBeVisible()
    await expect(page.locator('.pay-panel-detail')).toContainText(
      'Allow pop-ups for this site in your browser, then try again.'
    )
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('a connection the wallet ended asks to connect again', async ({
    page,
  }) => {
    await open(page, 'gate-disconnected-ended')
    await expect(page.locator('.pay-gate .pay-panel-title')).toHaveText(
      'Your wallet disconnected'
    )
    await expect(page.locator('.pay-gate')).toContainText(
      'Your wallet ended the connection. Connect again to continue.'
    )
    await page.getByRole('button', { name: 'Connect again' }).click()
    expect(
      await page.evaluate(() => (window as unknown as Calls).__calls)
    ).toEqual(['connect'])
  })
})

test.describe('testnet label', () => {
  test.use({ viewport: { width: 375, height: 900 } })

  test('every state with an amount or a transaction link names Stellar testnet', async ({
    page,
  }) => {
    const missing: string[] = []
    let checked = 0
    for (const state of STATES) {
      await open(page, state.id)
      const root = page.locator('[aria-label="Fixture"]')
      // The settlement rule ("reach 5 XLM") is a threshold, not an amount
      // that moved.
      const text = (await root.innerText()).replace(/reach \d+ XLM/g, '')
      const hasAmount = /\d XLM/.test(text)
      const hasLink =
        (await root.locator('a[href*="stellar.expert"]').count()) > 0
      if (!hasAmount && !hasLink) continue
      checked++
      const labels = await root.locator('.pay-network-name').allInnerTexts()
      if (!labels.some((label) => label.toLowerCase() === 'stellar testnet')) {
        missing.push(state.id)
      }
    }
    expect(checked).toBeGreaterThan(30)
    expect(missing).toEqual([])
  })

  test('tab tips with no transaction of their own have no explorer link', async ({
    page,
  }) => {
    for (const id of [
      'tab-tip-accepted',
      'tab-tip-shortfall',
      'tab-tip-unpaid',
      'tab-tip-rejected',
      'tab-tip-void-reset',
    ]) {
      await open(page, id)
      await expect(page.locator('a[href*="stellar.expert"]')).toHaveCount(0)
    }
    await open(page, 'tab-tip-settled')
    await expect(page.locator('a[href*="stellar.expert"]')).toHaveCount(1)
  })
})

test.describe('keyboard', () => {
  test('the gate action is the first stop and runs its handler', async ({
    page,
  }) => {
    await open(page, 'gate-disconnected')
    await page.keyboard.press('Tab')
    const action = page.getByRole('button', { name: 'Connect wallet' })
    await expect(action).toBeFocused()
    await page.keyboard.press('Enter')
    expect(
      await page.evaluate(() => (window as unknown as Calls).__calls)
    ).toEqual(['connect'])
  })

  test('each blocked gate state names its own action', async ({ page }) => {
    const actions: Record<string, string> = {
      'gate-signed-out': 'Sign in',
      'gate-no-wallet': 'Set up wallet',
      'gate-locked': 'Connect again',
      'gate-disconnected-ended': 'Connect again',
      'gate-wrong-network': 'Check again',
      'gate-unverified': 'Confirm wallet',
      'gate-other-account': 'Connect again',
    }
    for (const [id, name] of Object.entries(actions)) {
      await open(page, id)
      await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name })).toBeFocused()
    }
  })

  test('a ready gate shows its content and nothing else', async ({ page }) => {
    await open(page, 'gate-ready')
    await expect(page.getByRole('button', { name: 'Send tip' })).toBeVisible()
    await expect(page.locator('.pay-panel')).toHaveCount(0)
  })

  test('a busy gate keeps focus and ignores presses', async ({ page }) => {
    await open(page, 'gate-busy')
    await page.keyboard.press('Tab')
    const action = page.getByRole('button', {
      name: 'Waiting for your wallet…',
    })
    await expect(action).toBeFocused()
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await page.keyboard.press('Enter')
    expect(
      await page.evaluate(() => (window as unknown as Calls).__calls)
    ).toBeUndefined()
  })

  test('a failure reads retry, then the explorer link', async ({ page }) => {
    await open(page, 'result-failed')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('link', { name: /View the transaction/ })
    ).toBeFocused()
  })
})

test.describe('live regions and focus', () => {
  async function drive(page: Page, phase: string) {
    await page.evaluate(
      (next) =>
        (
          window as unknown as {
            __payments: { phase: (phase: string) => void }
          }
        ).__payments.phase(next),
      phase
    )
  }

  test('focus stays in the payment while it runs, then moves to the result', async ({
    page,
  }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    // The start button is gone: focus moves to the hidden progress heading,
    // which reads the step as its description, so it is not also announced.
    const progress = page.getByRole('heading', { name: 'Payment progress' })
    await expect(progress).toBeFocused()
    await expect(progress).toHaveAccessibleDescription('Checking the details…')
    await expect(polite(page)).toHaveText('')
    await drive(page, 'signing')
    await expect(polite(page)).toHaveText(
      'Approve the request in your wallet. It shows the network fee.'
    )
    await expect(progress).toBeFocused()
    await expect(
      page.locator('.pay-steps [aria-current="step"]')
    ).toContainText('Approve in wallet')
    await expect(page.locator('.pay-signing-help')).toHaveText(
      'Don’t see the request? Open your wallet extension.'
    )
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await drive(page, 'checking')
    await expect(polite(page)).toHaveText(
      'Waiting for confirmation. You can close this. The result shows in your tip history.'
    )
    await expect(progress).toBeFocused()
    await drive(page, 'failed')
    // The result title takes focus and reads its detail; the live regions
    // stay quiet so the result is not read twice.
    const title = page.getByRole('heading', { name: 'Not completed' })
    await expect(title).toBeFocused()
    await expect(title).toHaveAccessibleDescription(
      /Quilltip recorded no payment for this request\./
    )
    await expect(assertive(page)).toHaveText('')
    await expect(polite(page)).toHaveText('')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
    await page.keyboard.press('Enter')
    // "Try again" is gone too: focus goes back to the progress heading.
    await expect(
      page.getByRole('heading', { name: 'Payment progress' })
    ).toBeFocused()
  })

  test('a payment started from the keyboard shows where focus is', async ({
    page,
  }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('heading', { name: 'Payment progress' })
    ).toBeFocused()
    expect(
      await page
        .locator('.pay-progress')
        .evaluate((node) => getComputedStyle(node).outlineStyle)
    ).toBe('solid')
  })

  test('a wallet refusal is declined, and retry waits for the record', async ({
    page,
  }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    await drive(page, 'signing')
    await page.evaluate(() =>
      (
        window as unknown as {
          __payments: { source: (s: object) => void }
        }
      ).__payments.source({ record: { status: 'PREPARED' }, declined: true })
    )
    const title = page.getByRole('heading', {
      name: 'Request declined in your wallet',
    })
    await expect(title).toBeFocused()
    await expect(title).toHaveAccessibleDescription(
      /Nothing was signed or sent\./
    )
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await drive(page, 'declined')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
  })

  test('a confirmation is focused without a retry', async ({ page }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    await drive(page, 'checking')
    await drive(page, 'confirmed')
    const title = page.getByRole('heading', { name: 'Tip confirmed' })
    await expect(title).toBeFocused()
    await expect(title).toHaveAccessibleDescription(
      /1 XLM to Ada Lovelace.*Your tip is recorded on Stellar testnet\./
    )
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  })

  test('a result is announced, not focused, when focus is elsewhere', async ({
    page,
  }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    await drive(page, 'checking')
    await page.getByRole('link', { name: 'Elsewhere' }).focus()
    await drive(page, 'failed')
    await expect(assertive(page)).toHaveText(
      'Not completed. Quilltip recorded no payment for this request.'
    )
    await expect(page.getByRole('link', { name: 'Elsewhere' })).toBeFocused()
    await drive(page, 'checking')
    await expect(polite(page)).toContainText('Waiting for confirmation.')
    await expect(page.getByRole('link', { name: 'Elsewhere' })).toBeFocused()
    await drive(page, 'sent-to-registered')
    await expect(polite(page)).toContainText(
      'Tip sent to the article’s registered payout address.'
    )
    await expect(assertive(page)).toHaveText('')
  })

  test('a result shown on load does not take focus or animate', async ({
    page,
  }) => {
    await open(page, 'result-failed')
    await expect(page.locator('body')).toBeFocused()
    await expect(page.locator('.pay-panel')).not.toHaveAttribute(
      'data-enter',
      ''
    )
    // A payment already running at load (a reload) leaves focus alone too.
    for (const id of ['progress-checking', 'progress-resuming']) {
      await open(page, id)
      await page.waitForTimeout(100)
      await expect(page.locator('body')).toBeFocused()
    }
  })

  test('the gate keeps focus across states and hands it to the content', async ({
    page,
  }) => {
    await open(page, 'live-gate')
    const gate = (state: object) =>
      page.evaluate(
        (next) =>
          (
            window as unknown as {
              __payments: { gate: (state: object) => void }
            }
          ).__payments.gate(next),
        state
      )
    const live = page.locator('.pay-gate > [role="status"]')
    await page.waitForTimeout(250)
    await expect(live).toHaveText('')
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('button', { name: 'Connect wallet' })
    ).toBeFocused()
    await gate({ kind: 'locked' })
    await expect(
      page.getByRole('button', { name: 'Connect again' })
    ).toBeFocused()
    await expect(live).toHaveText(
      'Your wallet is locked. Unlock your wallet, then connect again.'
    )
    await gate({ kind: 'wrong-network', walletNetwork: 'Mainnet' })
    await expect(
      page.getByRole('button', { name: 'Check again' })
    ).toBeFocused()
    await expect(live).toContainText('Your wallet is on Mainnet.')
    await gate({ kind: 'ready' })
    await expect(page.getByRole('button', { name: 'Send tip' })).toBeFocused()
  })

  test('a notice that appears after an action is announced once', async ({
    page,
  }) => {
    await open(page, 'live-notice')
    await page.getByRole('button', { name: 'Send tip' }).click()
    const live = page.locator('.pay-notice > [role="status"]')
    await expect(live).toHaveText(
      'Payments are paused. Quilltip has paused new payments on Stellar testnet. Tips you already sent still settle, and you can still withdraw your tab.'
    )
    // The region existed, empty, before its text arrived.
    await expect(page.locator('.pay-notice [role="status"]')).toHaveCount(1)
  })
})

/**
 * One test per state, so the time per test does not grow with the state
 * list. The fixture marks the body once every effect of the first render has
 * run, and a fake clock runs past the announcement delay, so no test waits a
 * fixed time.
 */
test.describe('first render', () => {
  for (const state of STATES) {
    test(`${state.id} announces nothing and keeps focus on the page`, async ({
      page,
    }) => {
      await page.clock.install()
      await open(page, state.id)
      await expect(page.locator('body[data-settled]')).toBeAttached()
      // Any delayed first announcement (useAnnouncement) is due by now.
      await page.clock.runFor(SETTLE_MS * 10)
      for (const region of await page.locator('[aria-live]').all()) {
        await expect(region).toHaveText('')
      }
      await expect(page.locator('body')).toBeFocused()
    })
  }
})

test.describe('touch targets', () => {
  test.use({ viewport: { width: 375, height: 900 } })

  test('every kit button and link is at least 44px high', async ({ page }) => {
    const small: string[] = []
    for (const state of STATES) {
      await open(page, state.id)
      for (const control of await page
        .locator('.pay-action, .pay-link, .pay-note button')
        .all()) {
        const box = await control.boundingBox()
        if (box && (box.height < 44 || box.width < 44)) {
          small.push(`${state.id}: ${await control.innerText()}`)
        }
      }
    }
    expect(small).toEqual([])
  })
})

test.describe('motion', () => {
  test('a result reached after mount rises in once', async ({ page }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    await page.evaluate(() =>
      (
        window as unknown as { __payments: { phase: (p: string) => void } }
      ).__payments.phase('confirmed')
    )
    const panel = page.locator('.pay-panel')
    await expect(panel).toHaveAttribute('data-enter', '')
    expect(
      await panel.evaluate((node) => getComputedStyle(node).animationName)
    ).toBe('pay-rise')
    expect(
      await panel.evaluate((node) => getComputedStyle(node).animationDuration)
    ).toBe('0.22s')
  })

  test('reduced motion stops the entrance, the tick and the spinner', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, 'progress-signing')
    const spinner = page.locator('.pay-steps .pay-spinner')
    expect(
      await spinner.evaluate((node) => getComputedStyle(node).animationName)
    ).toBe('none')
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    await page.evaluate(() =>
      (
        window as unknown as { __payments: { phase: (p: string) => void } }
      ).__payments.phase('confirmed')
    )
    const panel = page.locator('.pay-panel')
    await expect(panel).toHaveAttribute('data-enter', '')
    expect(
      await panel.evaluate((node) => getComputedStyle(node).animationName)
    ).toBe('none')
    expect(
      await page
        .locator('.pay-check path')
        .evaluate((node) => getComputedStyle(node).animationName)
    ).toBe('none')
  })

  // The tab, writer and NFT surfaces are not inside the tip dialog, whose own
  // stylesheet also stops animation; this checks the kit's own rules.
  for (const reduce of [false, true]) {
    test(`on a page surface, ${reduce ? 'reduced motion stops' : 'normal motion plays'} the entrance, tick and spinner`, async ({
      page,
    }) => {
      await page.emulateMedia({
        reducedMotion: reduce ? 'reduce' : 'no-preference',
      })
      await open(page, 'live-progress', '&surface=page')
      await expect(page.locator('.tip-dialog')).toHaveCount(0)
      await page.getByRole('button', { name: 'Send tip' }).click()
      const spinner = page.locator('.pay-steps .pay-spinner')
      expect(
        await spinner.evaluate((node) => getComputedStyle(node).animationName)
      ).toBe(reduce ? 'none' : 'pay-spin')
      await page.evaluate(() =>
        (
          window as unknown as { __payments: { phase: (p: string) => void } }
        ).__payments.phase('confirmed')
      )
      const panel = page.locator('.pay-panel')
      await expect(panel).toHaveAttribute('data-enter', '')
      expect(
        await panel.evaluate((node) => getComputedStyle(node).animationName)
      ).toBe(reduce ? 'none' : 'pay-rise')
      expect(
        await page
          .locator('.pay-check path')
          .evaluate((node) => getComputedStyle(node).animationName)
      ).toBe(reduce ? 'none' : 'pay-draw')
    })
  }
})

test.describe('details', () => {
  test.use({ viewport: { width: 375, height: 900 } })

  test('the busy gate spinner takes the button text colour', async ({
    page,
  }) => {
    await open(page, 'gate-busy')
    const colours = await page.locator('.pay-action').evaluate((button) => ({
      text: getComputedStyle(button).color,
      ring: getComputedStyle(button.querySelector('.pay-spinner')!)
        .borderTopColor,
    }))
    expect(colours.ring).toBe(colours.text)
  })

  test('history labels stay on one line', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 })
    await open(page, 'label-status')
    for (const label of await page.locator('.pay-status').all()) {
      const box = await label.boundingBox()
      expect(box!.height).toBeLessThan(26)
    }
    await expect(page.getByText('Sent to updated address')).toBeVisible()
  })

  test('the quote says the XLM is not real, and an estimate says About and rounds (#670)', async ({
    page,
  }) => {
    await open(page, 'amount-tip')
    const caption = page.locator('.pay-amount-caption')
    await expect(caption).toContainText(quoteCopy('$0.12'))
    await expect(caption).not.toContainText(TESTNET_LABEL_DETAIL)
    await expect(caption).toContainText('Stellar testnet')
    await expect(caption).not.toContainText('in real XLM')
    // An exact figure keeps every stroop.
    await open(page, 'amount-long')
    await expect(page.locator('.pay-amount-total strong')).toHaveText(
      '10,000.0000001 XLM'
    )
    await open(page, 'amount-basket-full')
    await expect(caption).toContainText(quoteCopy('under-a-cent'))
    await open(page, 'amount-estimate')
    await expect(page.locator('.pay-amount-total strong')).toHaveText(
      'About 1 XLM'
    )
    await expect(caption).toContainText(ESTIMATE.caption)
    // An estimate is where a reader first meets the amount: the label's
    // detail shows; an exact summary keeps the label alone.
    await expect(caption).toContainText(TESTNET_LABEL_DETAIL)
    await open(page, 'amount-estimate-rounded')
    await expect(page.locator('.pay-amount-total strong')).toHaveText(
      'About 8.11 XLM'
    )
    // The parts add up to the total shown: 7.91 + 0.2 = 8.11.
    await expect(page.locator('.pay-amount-breakdown dd')).toHaveText([
      'About 7.91 XLM',
      'About 0.2 XLM',
    ])
    await expect(caption).toContainText(quoteCopy('$1'))
    // Without a price there is no estimate: dashes, never "About 0 XLM".
    await open(page, 'amount-estimate-none')
    await expect(page.locator('.pay-amount-total strong')).toHaveText('–')
    await expect(page.locator('.pay-amount')).not.toContainText('About 0')
  })

  test('only the other-account gate links to wallet settings for changing the linked address (#582)', async ({
    page,
  }) => {
    const settings = 'Change the linked address in wallet settings'
    // The unverified gate on the tab pages has a wallet settings link too
    // (`verifyHref`), for the link step, not for changing the address.
    for (const id of [
      'gate-unverified-link',
      'gate-unverified',
      'gate-disconnected',
      'gate-wrong-network',
    ]) {
      await open(page, id)
      await expect(page.getByRole('link', { name: settings })).toHaveCount(0)
    }
    await open(page, 'gate-other-account')
    await expect(page.getByRole('link', { name: settings })).toHaveCount(1)
  })

  test('the unverified gate shows a short address with the full one in the tooltip', async ({
    page,
  }) => {
    await open(page, 'gate-unverified')
    const detail = page.locator('.pay-panel-detail p')
    await expect(detail).toContainText('GBZX…MADI')
    await expect(detail).toHaveAttribute(
      'title',
      'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
    )
  })

  test('another account: asks to switch to the linked address, links to wallet settings, and never offers to link the other account (#582)', async ({
    page,
  }) => {
    await open(page, 'gate-other-account')
    const panel = page.locator('.pay-panel')
    await expect(
      panel.getByText('Switch your wallet to GCS5…DUAR', { exact: true })
    ).toBeVisible()
    await expect(panel.locator('.pay-panel-detail p')).toHaveText(
      'This is signed by GCS5…DUAR, the address linked to your Quilltip account. Your wallet is on GBZX…MADI. Switch accounts in your wallet, then connect again. Nothing was signed.'
    )
    await expect(
      panel.getByRole('link', {
        name: 'Change the linked address in wallet settings',
      })
    ).toHaveAttribute('href', '#wallet')
    await expect(panel.getByRole('button')).toHaveText(['Connect again'])
    await expect(
      panel.getByText(/Confirm wallet|link .* to your account/)
    ).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Send tip' })).toHaveCount(0)
  })

  test('under review gives a reference and help', async ({ page }) => {
    await open(page, 'result-under-review')
    await expect(page.locator('.pay-result-reference')).toContainText(
      'Reference: k57d9x2tq0hf3m8r1c4v6w'
    )
    await expect(page.getByRole('link', { name: 'Get help' })).toBeVisible()
  })

  test('the next step on a notice is a primary button', async ({ page }) => {
    await open(page, 'notice-withdrawal-ready')
    const withdraw = page.getByRole('button', { name: 'Withdraw 8.4 XLM' })
    const outline = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.pay-action')!).backgroundColor
    )
    await expect(withdraw).toBeVisible()
    await open(page, 'notice-settlement-delayed-writer')
    const secondary = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.pay-action')!).backgroundColor
    )
    expect(outline).not.toBe(secondary)
  })
})

test.describe('long content', () => {
  test.use({ viewport: { width: 375, height: 900 } })

  test('long amounts stay inside the summary', async ({ page }) => {
    await open(page, 'amount-long')
    const box = await page.locator('.pay-amount').boundingBox()
    for (const figure of await page.locator('.pay-amount-figure').all()) {
      const inner = await figure.boundingBox()
      expect(inner!.x + inner!.width).toBeLessThanOrEqual(
        box!.x + box!.width + 0.5
      )
    }
    await expect(page.locator('.pay-amount-total strong')).toHaveText(
      '10,000.0000001 XLM'
    )
  })

  test('a long error wraps inside the panel', async ({ page }) => {
    await open(page, 'result-failed-long')
    const panel = await page.locator('.pay-panel').boundingBox()
    const detail = await page.locator('.pay-panel-detail').boundingBox()
    expect(detail!.x + detail!.width).toBeLessThanOrEqual(
      panel!.x + panel!.width
    )
    await expect(page.locator('.pay-panel-detail')).toContainText(
      'Nothing was sent.'
    )
  })
})

test.describe('zoom and reflow', () => {
  // 200% zoom of a 1280px window is a 640px CSS viewport; WCAG reflow is 320px.
  for (const width of [640, 320]) {
    test(`every state reflows at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 })
      const overflowing: string[] = []
      for (const state of STATES) {
        await open(page, state.id)
        if ((await horizontalOverflow(page)) > 0) overflowing.push(state.id)
      }
      expect(overflowing).toEqual([])
    })
  }

  test('text spacing overrides do not clip content', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 })
    await open(page, 'notice-key-none')
    await page.addStyleTag({
      content:
        '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
    })
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
})

/**
 * The dashboard surface stays light in both appearances (#539). With
 * `html.dark`, a kit component on it must render exactly as in light
 * appearance and pass the contrast scan.
 */
const DASHBOARD = '[data-surface="dashboard"]'

test.describe('dashboard surface', () => {
  for (const state of STATES) {
    test(`${state.id} looks the same on the dashboard in dark appearance`, async ({
      page,
    }) => {
      await open(page, state.id, '&surface=dashboard')
      await expect(page.locator('body[data-settled]')).toBeAttached()
      const light = await surfaceColours(page, DASHBOARD)
      expect(await contrastScan(page, DASHBOARD)).toEqual([])
      await open(page, state.id, '&surface=dashboard&theme=dark')
      await expect(page.locator('html.dark body[data-settled]')).toBeAttached()
      expect(await contrastScan(page, DASHBOARD)).toEqual([])
      expect(await surfaceColours(page, DASHBOARD)).toEqual(light)
    })
  }

  test('screenshots of the dashboard states', async ({ page }) => {
    test.skip(!SHOTS, 'Set PAYMENT_SCREENSHOTS to save them.')
    test.setTimeout(120_000)
    const shown = [
      'gate-unverified-link',
      'gate-wrong-network',
      'progress-checking',
      'result-failed',
      'confirmed-tab-open',
      'notice-withdrawal-ready-link',
      'notice-key-none-link',
      'key-rows',
      'label-status',
    ]
    expect(shown.filter((id) => !STATES.some((s) => s.id === id))).toEqual([])
    for (const theme of ['light', 'dark'])
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: 900 })
        for (const state of STATES.filter((s) => shown.includes(s.id))) {
          await open(page, state.id, `&surface=dashboard&theme=${theme}`)
          await page.screenshot({
            path: path.join(
              SHOTS!,
              `dashboard-${theme}-${state.id}-${width}.png`
            ),
            fullPage: true,
            animations: 'disabled',
          })
        }
      }
  })
})

test.describe('dark theme', () => {
  for (const id of [
    'gate-wrong-network',
    'result-failed',
    'result-under-review',
    'notice-withdrawal-ready',
    'notice-insufficient-tab',
    'tab-tip-rejected',
    'result-declined',
    'key-rows',
    'label-status',
    'amount-tip',
    'amount-basket',
  ]) {
    test(`${id} passes the scan in dark mode`, async ({ page }) => {
      await open(page, id, '&theme=dark')
      expect(await axe(page)).toEqual([])
      if (SHOTS) {
        await page.screenshot({
          path: path.join(SHOTS, `dark-${id}-768.png`),
          fullPage: true,
          animations: 'disabled',
        })
      }
    })
  }
})
