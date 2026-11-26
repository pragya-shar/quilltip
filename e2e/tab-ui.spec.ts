import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { SCENARIOS } from './fixtures/tab-ui/scenarios'

/**
 * The tab screens (issue #449) in every state, against the fixture page on
 * port 4183: the real components, hooks and browser tab library, with a
 * stand-in Convex, indexer, settler, wallet and RPC.
 *
 *   bun e2e/fixtures/tab-ui/server.mjs
 *   bunx playwright test --config e2e/fixtures/tab-ui/playwright.config.ts
 *
 * Set TAB_UI_SCREENSHOTS=<dir> to save one screenshot per state at 375, 768
 * and 1440 px.
 */

const SHOTS = process.env.TAB_UI_SCREENSHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const WIDTHS = SHOTS
  ? ([320, 375, 768, 1440] as const)
  : ([320, 375, 1440] as const)

/** What each state shows first: a heading or notice title. */
const EXPECT: Record<string, string | RegExp> = {
  'home-no-tab': 'You don’t have a tab yet',
  'home-open': 'Free to tip',
  'home-worst': 'Free to tip',
  'collect-worst': 'Ready to collect',
  'home-empty-history': 'Tips you send from your tab show here',
  'home-loading': 'Loading your tab…',
  'home-signed-out': 'Sign in to continue',
  'home-unverified': 'Confirm this wallet is yours',
  'home-no-wallet': 'Free to tip',
  'home-disconnected': 'Free to tip',
  'home-locked': 'Free to tip',
  'home-wrong-network': 'Free to tip',
  'home-v2-disabled': 'Tabs are not available on this site yet',
  'home-paused': 'Payments are paused',
  'home-settlement-delayed': 'Settlement is taking longer than usual',
  'home-settle-window': 'Settlement is taking longer than usual',
  'home-settlement-off': 'Settlement is switched off',
  'home-closing': /Your balance unlocks around/,
  'home-withdraw-ready': 'Your balance is ready to withdraw',
  'home-closed': 'Your tab is closed',
  'key-none': 'Quick tips aren’t set up on this device',
  'key-pending': 'Setting up quick tips',
  'key-gone': 'This device’s quick-tip key is gone',
  'key-other-device': 'Quick tips aren’t set up on this device',
  'key-expired': 'Quick tips on this device have expired',
  'key-renew': /Quick tips here stop around/,
  'key-revoked': 'Quick tips are off for this device',
  'key-stopped': 'Quick tips are stopped on this device',
  'key-storage': 'This browser can’t keep a quick-tip key',
  'tip-ready': 'Tip from your tab',
  'tip-splits': /Quick tips don’t work for this article/,
  'tip-no-tab': 'You don’t have an open tab',
  'tip-closing': 'Your tab is closing',
  'tip-key-none': 'Quick tips aren’t set up on this device',
  'tip-key-gone': 'This device’s quick-tip key is gone',
  'tip-key-expired': 'Quick tips on this device have expired',
  'tip-settlement-off': 'Quick tips are unavailable right now',
  'tip-signed-out': 'Sign in to continue',
  'tip-v2-disabled': 'Quick tips are unavailable right now',
  'collect-ready': 'Ready to collect',
  'collect-nothing': 'Nothing to collect yet',
  'collect-none': 'No tab tips yet',
  'collect-delayed': 'Settlement is taking longer than usual',
  'collect-settlement-off': 'Settlement is switched off',
  'collect-unpaid': /tips will not be paid/,
  'collect-unverified': 'Confirm this wallet is yours',
  'collect-disconnected': 'Connect your wallet',
  'collect-paused': 'Ready to collect',
}

async function open(page: Page, id: string, session?: string) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.goto(`/?state=${id}${session ? `&session=${session}` : ''}`)
  await expect(page.getByTestId('fixture-state')).toBeVisible()
  return errors
}

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  )

async function axe(page: Page) {
  // Scan settled pixels: the kit's result rises in over 220 ms.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== 'running' ||
          a.effect?.getTiming().iterations === Infinity
      )
  )
  const results = await new AxeBuilder({ page })
    .include('.tab-ui')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}

/** Every visible XLM amount sits in a region that carries the testnet label. */
async function amountsLabelled(page: Page) {
  return page.evaluate(() => {
    const text = document.querySelector('.tab-ui')?.textContent ?? ''
    return !/\bXLM\b/.test(text) || text.includes('Stellar testnet')
  })
}

/** The stand-in backend's state for this page's session, read fresh. */
async function backend(page: Page): Promise<{ calls: string[] }> {
  const session = new URL(page.url()).searchParams.get('session')
  const res = await page.request.get(`/api/state?session=${session}`)
  return res.json()
}

/** Saves the current state at 375, 768 and 1440 px when TAB_UI_SCREENSHOTS is set. */
async function shot(page: Page, id: string) {
  if (!SHOTS) return
  const { width, height } = page.viewportSize()!
  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 900 })
    await page.screenshot({
      path: path.join(SHOTS, `${id}-${w}.png`),
      fullPage: true,
      animations: 'disabled',
    })
  }
  await page.setViewportSize({ width, height })
}

const visibleText = (page: Page, text: string | RegExp) =>
  page.locator('.tab-ui').getByText(text).first()

// --- Every state at phone and desktop widths ---------------------------------

for (const width of WIDTHS) {
  test.describe(`states at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    for (const [id, text] of Object.entries(EXPECT)) {
      test(`${id} renders, fits, is labelled and passes axe`, async ({
        page,
        browserName,
      }) => {
        test.skip(
          browserName !== 'chromium' && !SHOTS,
          'Layout runs in Chromium'
        )
        const errors = await open(page, id)
        await expect(visibleText(page, text)).toBeVisible()
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        expect(await amountsLabelled(page)).toBe(true)
        expect(await axe(page)).toEqual([])
        if (SHOTS && browserName === 'chromium') {
          await page.screenshot({
            path: path.join(SHOTS, `${id}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          })
        }
        expect(errors).toEqual([])
      })
    }
  })
}

test('the spec lists an expectation for every reader and writer state', () => {
  const driven = [...SCENARIOS.keys()].filter(
    (id) =>
      !id.startsWith('op-') &&
      !/^tip-(accepted|shortfall|unpaid|rejected|void|lost-response|stale|over-balance|key-limit|daily-limit|receipt-cap|above-max|two-tabs)$/.test(
        id
      ) &&
      !/^collect-(declined|checking)$/.test(id)
  )
  expect(driven.filter((id) => !(id in EXPECT))).toEqual([])
})

// --- Wallet operations -------------------------------------------------------

async function startTopUp(page: Page, amount = '5') {
  await page.getByRole('button', { name: 'Top up', exact: true }).click()
  await page.getByLabel('Amount in XLM').fill(amount)
  await page.getByRole('button', { name: /^Add / }).click()
}

const STEPS: Array<[string, string | RegExp]> = [
  ['op-pending-simulating', 'Checking the details…'],
  ['op-pending-signing', /Approve the request in your wallet/],
  ['op-pending-sending', 'Sending…'],
  ['op-checking', /Waiting for confirmation/],
]
for (const [id, text] of STEPS) {
  test(`top-up shows each pending step: ${id}`, async ({ page }) => {
    await open(page, id)
    await startTopUp(page)
    await expect(visibleText(page, text)).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Payment progress' })
    ).toBeAttached()
    await shot(page, id)
    expect(await axe(page)).toEqual([])
  })
}

const RESULTS: Array<[string, string | RegExp, boolean]> = [
  ['op-confirmed', 'Top-up confirmed', false],
  ['op-declined', 'Request declined in your wallet', true],
  ['op-send-error', 'Not sent', true],
  ['op-busy', 'Stellar testnet is busy', true],
  ['op-expired', 'This request timed out', true],
  ['op-failed', 'Not sent', true],
  ['op-wallet-balance', 'Not enough XLM in your wallet', false],
  ['op-locked', 'Your wallet is locked', false],
  ['op-paused', 'Payments are paused', false],
]
for (const [id, text, retry] of RESULTS) {
  test(`top-up result: ${id}`, async ({ page }) => {
    await open(page, id)
    await startTopUp(page)
    await expect(visibleText(page, text)).toBeVisible()
    const tryAgain = page.getByRole('button', { name: 'Try again' })
    if (retry) await expect(tryAgain).toBeVisible()
    else await expect(tryAgain).toHaveCount(0)
    await shot(page, id)
    expect(await amountsLabelled(page)).toBe(true)
    expect(await axe(page)).toEqual([])
  })
}

test('top-up refuses an amount the wallet cannot spend before any prompt', async ({
  page,
}) => {
  await open(page, 'op-low-funds')
  await page.getByRole('button', { name: 'Top up', exact: true }).click()
  await expect(
    visibleText(page, /Your wallet can spend 4\.5 XLM\./)
  ).toBeVisible()
  await page.getByLabel('Amount in XLM').fill('10')
  await page.getByRole('button', { name: /^Add / }).click()
  const input = page.getByLabel('Amount in XLM')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(input).toBeFocused()
  await shot(page, 'op-low-funds-error')
  const calls = (await backend(page)).calls
  expect(calls.filter((c) => c.startsWith('send:'))).toEqual([])
})

test('opens a tab with a new key in one approval, then tips from it', async ({
  page,
}) => {
  await open(page, 'home-no-tab')
  await page.getByRole('button', { name: 'Open a tab' }).click()
  await expect(visibleText(page, /Your wallet can spend 119 XLM/)).toBeVisible()
  await expect(visibleText(page, /Your tab will hold 10 XLM/)).toBeVisible()
  await shot(page, 'open-form')
  await page.getByRole('button', { name: 'Open tab with 10 XLM' }).click()
  await expect(visibleText(page, 'Your tab is open')).toBeVisible()
  await shot(page, 'open-confirmed')
  await expect(
    page.locator('.tab-ui').getByText('This device', { exact: true })
  ).toBeVisible()
  await expect(visibleText(page, 'Free to tip')).toBeVisible()
})

test('keyboard only: the top-up form submits with Enter and focus follows the payment', async ({
  page,
}) => {
  await open(page, 'op-confirmed')
  const topUp = page.getByRole('button', { name: 'Top up', exact: true })
  await topUp.focus()
  await page.keyboard.press('Enter')
  const input = page.getByLabel('Amount in XLM')
  await expect(input).toBeFocused()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('2')
  await page.keyboard.press('Enter')
  const result = page.getByRole('heading', { name: 'Top-up confirmed' })
  await expect(result).toBeVisible()
  // The start button is gone, so focus moves to the result title; a
  // focused title is not also announced (payment-states.md, Accessibility).
  await expect(result).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: 'Done' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Top up', exact: true })
  ).toBeVisible()
})

test('live regions are mounted empty and announce a result that keeps focus', async ({
  page,
}) => {
  await open(page, 'home-open')
  const regions = page.locator('.tab-ui [aria-live]')
  expect(await regions.count()).toBeGreaterThan(0)
  for (const text of await regions.allInnerTexts()) expect(text.trim()).toBe('')
  // A quick tip result arrives while focus stays on the page (no button removed).
  await page.goto('/?state=tip-ready')
  await page.getByRole('button', { name: /from tab$/ }).click()
  await expect(
    page.locator('.tab-ui').getByText('Tip sent from your tab').first()
  ).toBeVisible()
})

test('reload in the middle of a top-up resumes it and then confirms', async ({
  page,
}) => {
  await open(page, 'op-reload')
  await startTopUp(page)
  await expect(visibleText(page, /Waiting for confirmation/)).toBeVisible()
  await page.reload()
  await shot(page, 'op-reload-resumed')
  await expect(
    visibleText(
      page,
      /Checking whether this payment went through|Waiting for confirmation/
    )
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Top up', exact: true })
  ).toHaveCount(0)
  await expect(visibleText(page, 'Top-up confirmed')).toBeVisible({
    timeout: 10_000,
  })
})

test('reduced motion: results appear with no animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await open(page, 'op-confirmed')
  await startTopUp(page)
  await expect(visibleText(page, 'Top-up confirmed')).toBeVisible()
  const running = await page.evaluate(
    () =>
      document.getAnimations().filter((a) => a.playState === 'running').length
  )
  expect(running).toBe(0)
})

// --- Device key --------------------------------------------------------------

test('sets up quick tips on this device, then revokes them', async ({
  page,
}) => {
  await open(page, 'key-none')
  await page.getByRole('button', { name: 'Set up quick tips' }).first().click()
  await expect(
    visibleText(page, 'Quick tips are on for this device')
  ).toBeVisible()
  await shot(page, 'key-new-confirmed')
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: 'Revoke' }).first().click()
  await expect(
    visibleText(page, 'Quick tips are off for this device')
  ).toBeVisible()
  await shot(page, 'key-revoke-confirmed')
})

test('renews an expiring key with a new one', async ({ page }) => {
  await open(page, 'key-renew')
  await page.getByRole('button', { name: 'Renew quick tips' }).first().click()
  await expect(
    visibleText(page, 'Quick tips are on for this device')
  ).toBeVisible()
})

// --- Close and withdraw -------------------------------------------------------

test('closing states the waiting period and the estimated date first', async ({
  page,
}) => {
  await open(page, 'home-open')
  await page.getByRole('button', { name: 'Close tab' }).click()
  await expect(visibleText(page, 'Close your tab?')).toBeVisible()
  await shot(page, 'close-confirm')
  await expect(
    visibleText(page, /locked until around .+ \(an estimate/)
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Close tab and start the wait' })
    .click()
  await expect(visibleText(page, 'Withdrawal started')).toBeVisible()
  await shot(page, 'close-started')
})

test('Escape and Cancel return focus to the button that opened the step', async ({
  page,
}) => {
  await open(page, 'home-open')
  const topUp = page.getByRole('button', { name: 'Top up', exact: true })
  await topUp.click()
  await expect(page.getByLabel('Amount in XLM')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(topUp).toBeFocused()
  const close = page.getByRole('button', { name: 'Close tab' })
  await close.click()
  await expect(
    page.getByRole('heading', { name: 'Close your tab?' })
  ).toBeFocused()
  await page.getByRole('button', { name: 'Keep my tab open' }).click()
  await expect(close).toBeFocused()
})

test('withdraws once the unlock ledger has passed', async ({ page }) => {
  await open(page, 'home-withdraw-ready')
  await page.getByRole('button', { name: /^Withdraw / }).click()
  await expect(visibleText(page, 'Withdrawal complete')).toBeVisible()
  await shot(page, 'withdraw-confirmed')
})

// --- Collect -----------------------------------------------------------------

test('the writer collects with the fee from chain values', async ({ page }) => {
  await open(page, 'collect-ready')
  await expect(visibleText(page, 'Platform fee (2.5%)')).toBeVisible()
  await expect(visibleText(page, '0.3 XLM')).toBeVisible()
  await page.getByRole('button', { name: 'Collect 3.9 XLM' }).click()
  await expect(visibleText(page, 'Earnings collected')).toBeVisible()
  await shot(page, 'collect-confirmed')
  expect(await amountsLabelled(page)).toBe(true)
})

test('collect: wallet refusal and waiting for confirmation', async ({
  page,
}) => {
  await open(page, 'collect-declined')
  await page.getByRole('button', { name: /^Collect / }).click()
  await expect(
    visibleText(page, 'Request declined in your wallet')
  ).toBeVisible()
  await page.goto('/?state=collect-checking')
  await page.getByRole('button', { name: /^Collect / }).click()
  await expect(visibleText(page, /Waiting for confirmation/)).toBeVisible()
})
