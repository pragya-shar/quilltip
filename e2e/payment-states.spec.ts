import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { STATES } from './fixtures/payments/states'

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

test.describe('retry rule', () => {
  for (const state of STATES.filter((entry) => entry.group === 'result')) {
    const retryable = /^result-(failed|expired)/.test(state.id)
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
      'gate-locked': 'Try again',
      'gate-wrong-network': 'Check again',
      'gate-unverified': 'Confirm wallet',
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

  test('each step is announced politely and a failure assertively', async ({
    page,
  }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    await expect(polite(page)).toHaveText(
      'Checking the details with Stellar testnet…'
    )
    await drive(page, 'signing')
    await expect(polite(page)).toHaveText(
      'Approve the request in your wallet. It shows the network fee.'
    )
    await expect(
      page.locator('.pay-steps [aria-current="step"]')
    ).toContainText('Approve in wallet')
    await drive(page, 'checking')
    await expect(polite(page)).toContainText(
      'Waiting for Stellar testnet to confirm.'
    )
    await drive(page, 'failed')
    // The button that started the payment is gone; focus moves to the result
    // title, which reads its detail as the description. The live regions stay
    // quiet so the result is not read twice.
    const title = page.getByRole('heading', { name: 'Not sent' })
    await expect(title).toBeFocused()
    await expect(title).toHaveAccessibleDescription('Nothing was paid.')
    await expect(assertive(page)).toHaveText('')
    await expect(polite(page)).toHaveText('')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(polite(page)).toHaveText(
      'Checking the details with Stellar testnet…'
    )
  })

  test('a confirmation is announced and focused without a retry', async ({
    page,
  }) => {
    await open(page, 'live-progress')
    await page.getByRole('button', { name: 'Send tip' }).click()
    await drive(page, 'checking')
    await drive(page, 'confirmed')
    const title = page.getByRole('heading', { name: 'Tip confirmed' })
    await expect(title).toBeFocused()
    await expect(title).toHaveAccessibleDescription(
      'Your tip is recorded on Stellar testnet.'
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
    await expect(assertive(page)).toHaveText('Not sent. Nothing was paid.')
    await expect(page.getByRole('link', { name: 'Elsewhere' })).toBeFocused()
    await drive(page, 'checking')
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
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('button', { name: 'Connect wallet' })
    ).toBeFocused()
    await gate({ kind: 'locked' })
    await expect(page.getByRole('button', { name: 'Try again' })).toBeFocused()
    await expect(live).toHaveText(
      'Your wallet is locked. Unlock your wallet, allow QuillTip to connect, then try again.'
    )
    await gate({ kind: 'wrong-network', walletNetwork: 'Mainnet' })
    await expect(
      page.getByRole('button', { name: 'Check again' })
    ).toBeFocused()
    await expect(live).toContainText('Your wallet is on Mainnet.')
    await gate({ kind: 'ready' })
    await expect(page.getByRole('button', { name: 'Send tip' })).toBeFocused()
  })
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
      'Nothing was paid.'
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
    await open(page, 'notice-key-missing')
    await page.addStyleTag({
      content:
        '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
    })
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
  })
})

test.describe('dark theme', () => {
  for (const id of [
    'gate-wrong-network',
    'result-failed',
    'result-under-review',
    'notice-withdrawal-ready',
    'label-status',
    'amount-tip',
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
