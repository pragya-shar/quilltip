import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { SCENARIOS } from './fixtures/tab-ui/scenarios'
import { contrastScan, surfaceColours } from './helpers/lightSurface'

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
  'stats-wallet-and-tab': 'From wallets and settled tabs',
  'stats-lower-bound': 'At least',
  'stats-updating': 'Recounting your earnings. Check again in a few minutes.',
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
  'home-other-account': 'Switch your wallet to',
  'home-v2-disabled': 'Tabs are not available on this site yet',
  'home-paused': 'Payments are paused',
  'home-settlement-delayed': 'Settlement is taking longer than usual',
  'home-settle-window': 'Settlement is taking longer than usual',
  'home-settlement-off': 'Quick tips are paused on Stellar testnet',
  'home-settlement-off-none': 'Quick tips are paused on Stellar testnet',
  'home-settlement-off-open': 'Quick tips are paused on Stellar testnet',
  'home-closing': /Your balance unlocks around/,
  'home-short': 'Your tab is short',
  'home-withdraw-ready': 'Your balance is ready to withdraw',
  'home-closed': 'Your tab is closed',
  'key-none': 'Quick tips aren’t set up on this device',
  'key-pending': 'Setting up quick tips',
  'key-gone': 'This device’s quick-tip key is gone',
  'key-other-device': 'Quick tips are set up on another device',
  'key-unchecked': 'Quick tips can’t be checked right now',
  'key-expired': 'Quick tips on this device have expired',
  'key-renew': /Quick tips here stop around/,
  'key-revoked': 'Quick tips are off for this device',
  'key-stopped': 'Quick tips are stopped on this device',
  'key-storage': 'This browser can’t keep a quick-tip key',
  'tip-ready': 'Tip from your tab',
  'tip-splits': /Quick tips don’t work for this article/,
  'tip-no-tab': 'You don’t have an open tab',
  'tip-closing': 'Your tab is closing',
  'tip-short': 'Your tab is short',
  'tip-key-none': 'Quick tips aren’t set up on this device',
  'tip-key-gone': 'This device’s quick-tip key is gone',
  'tip-key-expired': 'Quick tips on this device have expired',
  'tip-key-other-device': 'Quick tips are set up on another device',
  'tip-key-storage': 'This browser can’t keep a quick-tip key',
  'tip-key-stopped': 'Quick tips are stopped on this device',
  'tip-key-pending': 'Setting up quick tips',
  'tip-key-revoked': 'Quick tips are off for this device',
  'tip-key-unchecked': 'Quick tips can’t be checked right now',
  'tip-settlement-off': 'Quick tips are unavailable right now',
  'tip-settlement-off-no-tab': 'Quick tips are unavailable right now',
  'tip-signed-out': 'Sign in to continue',
  'tip-v2-disabled': 'Quick tips are unavailable right now',
  'collect-ready': 'Ready to collect',
  'collect-nothing': 'Nothing to collect yet',
  'collect-none': 'No tab tips yet',
  'collect-delayed': 'Settlement is taking longer than usual',
  'collect-settlement-off': 'Tab settlement is paused on Stellar testnet',
  'collect-shortfall': /from one reader whose tab ran short/,
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

/**
 * Every XLM amount sits in a section, form or kit surface that carries its
 * own testnet label: the page intro's label does not count for the figures
 * below it.
 */
async function amountsLabelled(page: Page) {
  const unlabelled = await page.evaluate(() =>
    [...document.querySelectorAll('.tab-ui .pay-xlm')]
      // The kit's progress and notices carry their own label.
      .map((amount) =>
        amount.closest('section, form, .pay-progress, .pay-notice')
      )
      .filter((region) => !region?.querySelector('.pay-network'))
      .map(
        (region) =>
          region?.getAttribute('aria-labelledby') ??
          region?.className ??
          'no region'
      )
  )
  if (unlabelled.length) console.log('unlabelled amounts in', unlabelled)
  return unlabelled.length === 0
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

// --- Dark appearance (#539) -------------------------------------------------
// The dashboard surface stays light when the site is dark: every state must
// render exactly as in light appearance, with no contrast violation.

const SURFACE = '.account-surface'

test.describe('states in dark appearance', () => {
  test.use({ viewport: { width: 768, height: 900 } })
  for (const [id, text] of Object.entries(EXPECT)) {
    test(`${id} looks the same in dark appearance`, async ({
      page,
      browserName,
    }) => {
      test.skip(browserName !== 'chromium', 'Colours are checked in Chromium')
      await open(page, id)
      await expect(visibleText(page, text)).toBeVisible()
      expect(await axe(page)).toEqual([])
      const light = await surfaceColours(page, SURFACE)
      await page.goto(`/?state=${id}&theme=dark`)
      await expect(page.locator('html.dark')).toBeAttached()
      await expect(visibleText(page, text)).toBeVisible()
      expect(await axe(page)).toEqual([])
      expect(await contrastScan(page, SURFACE)).toEqual([])
      expect(await surfaceColours(page, SURFACE)).toEqual(light)
      if (SHOTS) {
        for (const w of [375, 768, 1440]) {
          await page.setViewportSize({ width: w, height: 900 })
          await page.screenshot({
            path: path.join(SHOTS, `dark-${id}-${w}.png`),
            fullPage: true,
            animations: 'disabled',
          })
        }
      }
    })
  }
})

test('the spec lists an expectation for every reader and writer state', () => {
  const driven = [...SCENARIOS.keys()].filter(
    (id) =>
      !id.startsWith('op-') &&
      // The tip dialog states run in e2e/tab-tip-dialog.spec.ts.
      !id.startsWith('dialog-') &&
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
  ['op-failed', 'Not completed', true],
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

test('top-up signed by another account names the linked address on the tab page (#582)', async ({
  page,
}) => {
  const errors = await open(page, 'op-wrong-account')
  await startTopUp(page)
  await expect(
    visibleText(page, 'Your wallet signed with another account')
  ).toBeVisible()
  await expect(
    visibleText(
      page,
      'Switch your wallet to GAUY…IUQ7, the address linked to your Quilltip account, or reconnect. Nothing was sent.'
    )
  ).toBeVisible()
  await expect(
    page.getByText('Switch back to the connected account')
  ).toHaveCount(0)
  expect(await axe(page)).toEqual([])
  expect(errors).toEqual([])
})

// --- Settlement off: what the reader can and cannot do -----------------------

test('settlement off, no tab: says why and offers no tab to open', async ({
  page,
}) => {
  await open(page, 'home-settlement-off-none')
  const notice = visibleText(page, 'Quick tips are paused on Stellar testnet')
  await expect(notice).toBeVisible()
  await expect(
    visibleText(
      page,
      /opening a tab is paused too.*tip any article from your wallet/
    )
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open a tab' })).toHaveCount(0)
  expect((await backend(page)).calls).toEqual([])
})

test('settlement off, open tab: no top-up or new key; close, withdraw and revoke stay', async ({
  page,
}) => {
  await open(page, 'home-settlement-off-open')
  await expect(
    visibleText(page, /can’t tip from your tab or add funds to it/)
  ).toBeVisible()
  // Nothing waits, so the waiting sentence stays out.
  await expect(
    visibleText(page, /Tips you already sent from your tab are recorded/)
  ).toHaveCount(0)
  for (const name of ['Top up', 'Set up quick tips', 'Renew quick tips'])
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
  await expect(
    visibleText(page, /Setting up quick tips is paused/)
  ).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close tab' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Revoke/ })).toBeVisible()
})

test('settlement off with tips waiting: says they settle when quick tips are back', async ({
  page,
}) => {
  await open(page, 'home-settlement-off')
  await expect(
    visibleText(page, /Tips you already sent from your tab are recorded/)
  ).toBeVisible()
})

// --- Keys: this device, and each quick tip key state -------------------------

for (const id of ['key-expired', 'key-stopped']) {
  test(`${id}: this browser's own key is labelled This device`, async ({
    page,
  }) => {
    await open(page, id)
    const list = page.getByRole('list', { name: 'Quick tips on this device' })
    await expect(list.getByText('This device', { exact: true })).toBeVisible()
    await expect(list.getByText('Another device or browser')).toHaveCount(0)
  })
}

test('key-other-device: a key held elsewhere is labelled as another device', async ({
  page,
}) => {
  await open(page, 'key-other-device')
  const list = page.getByRole('list', { name: 'Quick tips on this device' })
  await expect(list.getByText('Another device or browser')).toBeVisible()
  await expect(list.getByText('This device', { exact: true })).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Set up quick tips' })
  ).toBeVisible()
})

const TIP_KEY_STEPS: Array<[string, RegExp, string]> = [
  ['tip-key-storage', /Its storage is blocked/, 'Tip from wallet'],
  ['tip-key-stopped', /did not match Quilltip’s/, 'Set up quick tips'],
  ['tip-key-pending', /registration is not confirmed/, 'Finish setting up'],
  ['tip-key-revoked', /You revoked its key/, 'Set up quick tips'],
  ['tip-key-other-device', /on another device or browser/, 'Set up quick tips'],
  ['tip-key-unchecked', /could not reach Stellar testnet/, 'Tip from wallet'],
]
for (const [id, cause, step] of TIP_KEY_STEPS) {
  test(`quick tip ${id}: its own cause and next step`, async ({ page }) => {
    await open(page, id)
    await expect(visibleText(page, cause)).toBeVisible()
    await expect(
      page
        .locator('.tab-ui')
        .getByRole(step === 'Tip from wallet' ? 'button' : 'link', {
          name: step,
        })
    ).toBeVisible()
    await expect(visibleText(page, /It takes one wallet approval/)).toHaveCount(
      0
    )
  })
}

test('another account in the wallet: switch to the linked address, the balance unchanged, no link step (#582)', async ({
  page,
}) => {
  await open(page, 'home-open')
  const figures = page.locator('.tab-figures')
  await expect(figures).toBeVisible()
  const balance = (await figures.textContent()) ?? ''

  const errors = await open(page, 'home-other-account')
  await expect(figures).toHaveText(balance)
  const panel = page.locator('.pay-panel[data-state="other-account"]')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText(/^Switch your wallet to G[A-Z2-7]{3}…/)
  await expect(panel).toContainText(
    'the address linked to your Quilltip account. Your wallet is on GBZX…MADI.'
  )
  await expect(
    panel.getByRole('button', { name: 'Connect again' })
  ).toBeVisible()
  await expect(
    panel.getByRole('link', {
      name: 'Change the linked address in wallet settings',
    })
  ).toHaveAttribute('href', '#verify')
  // No link step for the other account, anywhere on the page.
  await expect(
    page.getByRole('button', { name: 'Confirm wallet' })
  ).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Confirm wallet' })).toHaveCount(
    0
  )
  await expect(page.getByText(/to link .* to your account/)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('no verified linked address: the link step stays (#582)', async ({
  page,
}) => {
  await open(page, 'home-unverified')
  await expect(page.getByText('Confirm this wallet is yours')).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Confirm wallet' })
  ).toHaveAttribute('href', '#verify')
  await expect(page.locator('[data-state="other-account"]')).toHaveCount(0)
})

test('an unreachable Stellar RPC never shows an expired key as ready', async ({
  page,
}) => {
  await open(page, 'key-unchecked')
  await expect(
    visibleText(page, 'Quick tips can’t be checked right now')
  ).toBeVisible()
  await expect(
    visibleText(page, 'Quick tips on this device have expired')
  ).toHaveCount(0)
})

// --- History and the writer ---------------------------------------------------

test('recent tab tips label every receipt status', async ({ page }) => {
  await open(page, 'home-open')
  const labels = page.locator('.tab-tip-row .pay-status')
  await expect(labels).toHaveText([
    'Settling',
    'Settled',
    'Waiting for balance',
    'Not paid',
    'Not settled',
    'Cleared by reset',
  ])
})

test('Read more links have a 44px hit area at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 })
  await open(page, 'home-open')
  const links = page.locator('.tab-ui .tab-inline-link')
  // The history renders after the tab loads.
  await expect(links.first()).toBeVisible()
  for (const box of await links.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height)
  ))
    expect(box).toBeGreaterThanOrEqual(44)
})

test('the writer sees which waiting tips depend on a reader top-up', async ({
  page,
}) => {
  await open(page, 'collect-shortfall')
  await expect(
    visibleText(
      page,
      '0.4875 XLM of what is waiting is from one reader whose tab ran short. It settles after that reader adds funds to their tab.'
    )
  ).toBeVisible()
})

// --- Fund form bounds ---------------------------------------------------------

test('a wallet below the minimum deposit is told so, with no inverted range', async ({
  page,
}) => {
  await open(page, 'op-wallet-short')
  await page.getByRole('button', { name: 'Top up', exact: true }).click()
  await expect(
    visibleText(
      page,
      'Your wallet can spend 0.5 XLM, less than the smallest deposit of 1 XLM. Add test XLM to your wallet, then try again.'
    )
  ).toBeVisible()
  await expect(visibleText(page, /^Between /)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(0)
  expect(await axe(page)).toEqual([])
})

test('a tab with less room than the minimum deposit is told so', async ({
  page,
}) => {
  await open(page, 'op-tab-full')
  await page.getByRole('button', { name: 'Top up', exact: true }).click()
  await expect(
    visibleText(
      page,
      'Your tab can take 0.5 XLM more, less than the smallest deposit of 1 XLM.'
    )
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /^Add / })).toHaveCount(0)
})

test('an invalid amount is described on the field after submit', async ({
  page,
}) => {
  await open(page, 'home-open')
  await page.getByRole('button', { name: 'Top up', exact: true }).click()
  const field = page.getByLabel('Amount in XLM')
  await field.fill('abc')
  await page
    .getByRole('button', { name: /^Add|^Top up/ })
    .last()
    .click()
  await expect(field).toHaveAccessibleDescription(
    /Enter an amount in XLM, with up to 7 decimals\./
  )
  await expect(field).toHaveAttribute('aria-invalid', 'true')
})

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

test('after an open is sent, the page waits for the first events and asks for nothing (#547)', async ({
  page,
}) => {
  await open(page, 'op-opening')
  await page.getByRole('button', { name: 'Open a tab' }).click()
  await page.getByRole('button', { name: 'Open tab with 10 XLM' }).click()
  await expect(
    page.getByRole('heading', { name: 'Opening your tab' })
  ).toBeVisible()
  await expect(visibleText(page, /There is nothing else to do\./)).toBeVisible()
  // No open tab with zero balances, no key to finish, no confirmation yet.
  await expect(visibleText(page, 'Your tab is open')).toHaveCount(0)
  await expect(visibleText(page, 'Free to tip')).toHaveCount(0)
  await expect(
    visibleText(page, /Finish it with one wallet approval/)
  ).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open a tab' })).toHaveCount(0)
  await shot(page, 'op-opening')
  // Once the "indexer" applies the open, the tab is confirmed.
  await expect(visibleText(page, 'Your tab is open')).toBeVisible({
    timeout: 10_000,
  })
  await expect(visibleText(page, 'Free to tip')).toBeVisible()
})

test('while the tab is closing, the free balance is not offered for quick tips (#547)', async ({
  page,
}) => {
  await open(page, 'home-closing')
  await expect(visibleText(page, /Your balance unlocks around/)).toBeVisible()
  const balance = page.getByRole('region', { name: 'Balance' })
  await expect(balance.getByText('Free to tip', { exact: true })).toHaveCount(0)
  await expect(
    balance.getByText('What quick tips can use now.', { exact: true })
  ).toHaveCount(0)
  await expect(
    balance.getByText('Comes back to you', { exact: true })
  ).toBeVisible()
  await expect(
    balance.getByText(/Your tab is closing, so quick tips are off\./)
  ).toBeVisible()
  // An open tab still offers it.
  await page.goto('/?state=home-open')
  await expect(
    page.getByRole('region', { name: 'Balance' }).getByText('Free to tip', {
      exact: true,
    })
  ).toBeVisible()
})

test('the stats cover the same tips in XLM, dollars and count (#552)', async ({
  page,
}) => {
  await open(page, 'stats-wallet-and-tab')
  const stat = (label: string) =>
    page.locator('.account-stat').filter({ hasText: label })
  await expect(stat('Earned (testnet)')).toContainText('114.58 XLM')
  // The testnet note stays beside the dollar figure.
  await expect(stat('Earned (testnet)')).toContainText(
    '≈ $14.87, testnet, no real value'
  )
  await expect(stat('Tips received')).toContainText('9')
  await expect(stat('Tips received')).toContainText(
    'From wallets and settled tabs'
  )
  const card = page.getByTestId('compact-earnings')
  await expect(card).toContainText('114.58 XLM')
  await expect(card).toContainText('≈ $14.87, testnet, no real value')
  await expect(card).toContainText('9 testnet tips received')
  await expect(card).not.toContainText('At least')
})

test('lower bounds say "At least" on the count, the XLM and the dollars (#552)', async ({
  page,
}) => {
  await open(page, 'stats-lower-bound')
  const stat = (label: string) =>
    page.locator('.account-stat').filter({ hasText: label })
  await expect(stat('Earned (testnet)').locator('dd')).toHaveText(
    'At least1,950.98 XLMat least $195.10, testnet, no real value'
  )
  await expect(stat('Tips received').locator('dd')).toHaveText('At least2,001')
  await expect(stat('Articles').locator('dd')).toHaveText('4')
  // The dashboard card says the same.
  const card = page.getByTestId('compact-earnings')
  await expect(card).toContainText('At least')
  await expect(card).toContainText('1,950.98 XLM')
  await expect(card).toContainText('at least $195.10, testnet, no real value')
  await expect(card).toContainText('At least 2,001 testnet tips received')
})

test('while the totals are rebuilt, both cards keep the previous figures and say so (#552)', async ({
  page,
}) => {
  await open(page, 'stats-updating')
  const stat = (label: string) =>
    page.locator('.account-stat').filter({ hasText: label })
  await expect(stat('Earned (testnet)').locator('dd')).toHaveText(
    '114.58 XLM≈ $13.65, testnet, no real value'
  )
  // The previous figures do not claim tab tips.
  await expect(stat('Tips received').locator('dd')).toHaveText(
    '6Recounting your earnings. Check again in a few minutes.'
  )
  const card = page.getByTestId('compact-earnings')
  await expect(card).toContainText('114.58 XLM')
  await expect(card).toContainText('6 testnet tips received')
  await expect(card).toContainText(
    'Recounting your earnings. Check again in a few minutes.'
  )
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
  // A resumed payment renders with the page: it leaves focus alone.
  await expect(page.locator('.tab-ui :focus')).toHaveCount(0)
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
  await shot(page, 'collect-declined')
  await page.goto('/?state=collect-checking')
  await page.getByRole('button', { name: /^Collect / }).click()
  await expect(visibleText(page, /Waiting for confirmation/)).toBeVisible()
  await shot(page, 'collect-checking')
})
