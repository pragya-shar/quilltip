import { test, expect, type Locator, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

import { installVarialEmulator } from './helpers/varialEmulator'

/**
 * The tab tip section of the article and passage tip dialogs (issue #546),
 * on the tab UI fixture's dialog page (port 4183, `/dialog`): the real tip
 * dialogs, the real tab section and browser tab library, a stand-in tab
 * backend for the scenario `state`, and the v2 tip fixture's stand-ins for
 * the wallet tip.
 *
 *   bun e2e/fixtures/tab-ui/server.mjs
 *   bunx playwright test --config e2e/fixtures/tab-ui/playwright.config.ts e2e/tab-tip-dialog.spec.ts
 *
 * Set TAB_DIALOG_SCREENSHOTS=<dir> to save each state at 375, 768 and 1440 px.
 */

const SHOTS = process.env.TAB_DIALOG_SCREENSHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })
const UNUSED = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

type Variant = 'article' | 'passage'
const VARIANTS: Variant[] = ['article', 'passage']

async function open(page: Page, state: string, query = '') {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  await page.goto(`/dialog?state=${state}${query ? `&${query}` : ''}`)
  await expect(page.getByTestId('fixture-state')).toBeVisible()
  return errors
}

async function openDialog(page: Page, variant: Variant): Promise<Locator> {
  await page
    .getByRole('button', {
      name: variant === 'article' ? 'Tip article' : 'Tip passage',
    })
    .click()
  const dialog = page.getByRole('dialog', {
    name: variant === 'article' ? 'Tip this article' : 'Tip this passage',
  })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The dialog's tab section, once it loaded. */
const tabSection = (dialog: Locator) =>
  dialog.getByRole('region', { name: 'From your tab' })

/** The stand-in tab backend's state for this page's session. */
async function backend(page: Page): Promise<{ calls: string[] }> {
  const session = new URL(page.url()).searchParams.get('session')
  const res = await page.request.get(`/api/state?session=${session}`)
  return res.json()
}

async function presets(dialog: Locator): Promise<string[]> {
  return dialog
    .getByRole('group', { name: 'Preset amounts' })
    .getByRole('button')
    .allTextContents()
}

async function axe(page: Page) {
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
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .exclude('stellar-wallets-modal')
    .analyze()
  return results.violations.map(
    (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`
  )
}

const overflow = (page: Page) =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  )

/** Saves the dialog at 375, 768 and 1440 px when TAB_DIALOG_SCREENSHOTS is set. */
async function shot(page: Page, id: string) {
  if (!SHOTS) return
  const { width, height } = page.viewportSize()!
  for (const w of [375, 768, 1440]) {
    await page.setViewportSize({ width: w, height: 1000 })
    await page.waitForTimeout(150)
    await page.getByRole('dialog').screenshot({
      path: path.join(SHOTS, `${id}-${w}.png`),
      animations: 'disabled',
    })
  }
  await page.setViewportSize({ width, height })
}

/** Chooses an amount in the dialog's one amount field. */
async function chooseAmount(dialog: Locator, dollars: string) {
  await dialog.getByLabel('Other amount').fill(dollars)
}

// --- Every state, in both dialogs ---------------------------------------------

type StateCase = {
  state: string
  /** What the dialog shows once the tab section has its state. */
  expect: (dialog: Locator) => Promise<void>
  /** Runs before the expectation: choose an amount, send. */
  act?: (dialog: Locator) => Promise<void>
  query?: string
}

const sendFromTab = async (dialog: Locator) => {
  await tabSection(dialog)
    .getByRole('button', { name: /^Send \$\d+\.\d\d from your tab$/ })
    .click()
}

const STATES: Record<string, StateCase> = {
  loading: {
    state: 'dialog-loading',
    expect: async (dialog) => {
      await expect(
        dialog.getByRole('status').filter({ hasText: 'Checking your tab…' })
      ).toBeAttached()
      await expect(tabSection(dialog)).toHaveCount(0)
    },
  },
  'no-tab': {
    state: 'tip-no-tab',
    expect: async (dialog) => {
      await expect(
        dialog.getByText('Tip without a wallet prompt from a prepaid tab.')
      ).toBeVisible()
      await expect(
        dialog.getByRole('link', { name: 'Open a tab' })
      ).toHaveAttribute('href', '/dashboard/tab')
      // The wallet tip stays the primary action, under its usual name.
      await expect(
        dialog.getByRole('button', { name: 'Connect wallet' })
      ).toBeVisible()
      await expect(tabSection(dialog)).toHaveCount(0)
    },
  },
  'no-key': {
    state: 'tip-key-none',
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText(
          'Quick tips aren’t set up on this device',
          { exact: true }
        )
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByRole('link', { name: 'Set up quick tips' })
      ).toBeVisible()
    },
  },
  'settlement-off': {
    state: 'tip-settlement-off',
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText(
          /is not accepting tips from tabs on Stellar testnet right now/
        )
      ).toBeVisible()
      await expect(tabSection(dialog).getByRole('button')).toHaveCount(0)
    },
  },
  ready: {
    state: 'tip-ready',
    expect: async (dialog) => {
      await expect(tabSection(dialog).getByText('20 XLM free')).toBeVisible()
      await expect(
        tabSection(dialog).getByRole('button', {
          name: 'Send $0.10 from your tab',
        })
      ).toBeVisible()
      await expect(
        dialog.getByText('Tab tips go up to $0.50 at today’s XLM price.', {
          exact: false,
        })
      ).toBeVisible()
    },
  },
  'above-max': {
    state: 'tip-ready',
    act: (dialog) => chooseAmount(dialog, '0.75'),
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText('Tab tips go up to $0.50 right now', {
          exact: true,
        })
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByRole('button', {
          name: 'Send $0.75 from your tab',
        })
      ).toHaveAttribute('aria-disabled', 'true')
    },
  },
  short: {
    state: 'tip-short',
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText('Your tab is short', { exact: true })
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByText(
          'Tips you already sent need 0.3 XLM more than your tab holds.',
          { exact: false }
        )
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByRole('link', { name: 'Top up' })
      ).toBeVisible()
      // No free figure and no send button while the tab is short (#617).
      await expect(tabSection(dialog).getByText(/free$/)).toHaveCount(0)
      await expect(
        tabSection(dialog).getByRole('button', { name: /from your tab$/ })
      ).toHaveCount(0)
    },
  },
  'not-enough': {
    state: 'tip-over-balance',
    act: (dialog) =>
      dialog.getByRole('button', { name: '$0.25', exact: true }).click(),
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText('Not enough in your tab', { exact: true })
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByRole('link', { name: 'Top up' })
      ).toBeVisible()
    },
  },
  accepted: {
    state: 'tip-accepted',
    act: sendFromTab,
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText('Tip sent from your tab', { exact: true })
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByText('1 XLM to Ada Lovelace')
      ).toBeVisible()
      // The amount and the wallet tip step aside while the result shows.
      await expect(
        dialog.getByRole('group', { name: 'Preset amounts' })
      ).toHaveCount(0)
      await expect(dialog.getByRole('button', { name: /wallet/i })).toHaveCount(
        0
      )
    },
  },
  settled: {
    state: 'tip-ready',
    act: sendFromTab,
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText('Tip settled', { exact: true })
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByRole('link', { name: /View the transaction/ })
      ).toBeVisible()
    },
  },
  rejected: {
    state: 'tip-rejected',
    act: sendFromTab,
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText('Not settled', { exact: true })
      ).toBeVisible()
    },
  },
  splits: {
    state: 'tip-splits',
    expect: async (dialog) => {
      await expect(
        tabSection(dialog).getByText(/shares tips with co-authors/)
      ).toBeVisible()
      await expect(tabSection(dialog).getByRole('button')).toHaveCount(0)
      await expect(
        dialog.getByRole('button', { name: 'Connect wallet' })
      ).toBeVisible()
    },
  },
}

for (const variant of VARIANTS) {
  test.describe(`${variant} dialog`, () => {
    test.use({ viewport: { width: 1440, height: 1000 } })
    for (const [name, c] of Object.entries(STATES)) {
      test(`${name}: designed, labelled and passes axe`, async ({ page }) => {
        const errors = await open(page, c.state, c.query)
        const dialog = await openDialog(page, variant)
        if (c.act) {
          await expect(
            tabSection(dialog).getByRole('heading', { name: 'From your tab' })
          ).toBeVisible()
          await c.act(dialog)
        }
        await c.expect(dialog)
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        expect(await axe(page)).toEqual([])
        await shot(page, `${variant}-${name}`)
        expect(errors).toEqual([])
      })
    }
  })
}

// --- One amount choice and the tab tip maximum --------------------------------

test.describe('one amount for the dialog', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('no preset is above the tab tip maximum, and the tab shows none of its own', async ({
    page,
  }) => {
    await open(page, 'tip-ready')
    const dialog = await openDialog(page, 'article')
    await expect(tabSection(dialog)).toBeVisible()
    // $1, $2 and $5 are 10, 20 and 50 XLM: all above the 5 XLM maximum.
    await expect
      .poll(() => presets(dialog))
      .toEqual(['$0.10', '$0.25', '$0.50'])
    await expect(
      dialog.getByRole('group', { name: 'Preset amounts' })
    ).toHaveCount(1)
    await expect(dialog.locator('.tab-presets')).toHaveCount(0)
  })

  test('a lower maximum lowers the presets with it', async ({ page }) => {
    await open(page, 'dialog-low-max')
    const dialog = await openDialog(page, 'passage')
    await expect(tabSection(dialog)).toBeVisible()
    await expect
      .poll(() => presets(dialog))
      .toEqual(['$0.05', '$0.10', '$0.25'])
  })

  test('without a tab, the presets stay as they are', async ({ page }) => {
    await open(page, 'tip-no-tab')
    const dialog = await openDialog(page, 'article')
    await expect(dialog.getByRole('link', { name: 'Open a tab' })).toBeVisible()
    expect(await presets(dialog)).toEqual(['$1', '$2', '$5'])
  })

  test('the chosen amount is the amount the tab sends', async ({ page }) => {
    await open(page, 'tip-accepted')
    const dialog = await openDialog(page, 'article')
    await dialog.getByRole('button', { name: '$0.25', exact: true }).click()
    await tabSection(dialog)
      .getByRole('button', { name: 'Send $0.25 from your tab' })
      .click()
    await expect(
      tabSection(dialog).getByText('2.5 XLM to Ada Lovelace')
    ).toBeVisible()
  })

  test('an amount above the maximum is explained and never sent', async ({
    page,
  }) => {
    const errors = await open(page, 'tip-ready')
    const dialog = await openDialog(page, 'article')
    await chooseAmount(dialog, '0.75')
    const send = tabSection(dialog).getByRole('button', {
      name: 'Send $0.75 from your tab',
    })
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    // The reason is the button's description, for screen readers too.
    await expect(send).toHaveAccessibleDescription(
      'Tab tips go up to $0.50 right now. That is the most a tab tip can be at today’s XLM price. Choose $0.50 or less, or send this amount from your wallet.'
    )
    await send.click({ force: true })
    await page.waitForTimeout(400)
    expect((await backend(page)).calls).not.toContain('prepareTip')
    // The wallet can still send it.
    await expect(
      dialog.getByRole('button', { name: 'Connect wallet' })
    ).toBeVisible()
    expect(errors).toEqual([])
  })

  test('limits other than the maximum are explained before sending', async ({
    page,
  }) => {
    await open(page, 'dialog-daily-left')
    let dialog = await openDialog(page, 'article')
    await expect(
      tabSection(dialog).getByText('This is over today’s tab limit', {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      tabSection(dialog)
        .locator('.pay-panel')
        .getByText(/You can tip 0\.5 XLM more from your tab today/)
    ).toBeVisible()

    await open(page, 'dialog-key-limit')
    dialog = await openDialog(page, 'article')
    await expect(
      tabSection(dialog).getByText(
        'This is over this device’s quick-tip limit',
        { exact: true }
      )
    ).toBeVisible()

    await open(page, 'dialog-no-price')
    dialog = await openDialog(page, 'article')
    await expect(
      tabSection(dialog).getByText('No XLM price right now', { exact: true })
    ).toBeVisible()
    expect((await backend(page)).calls).not.toContain('prepareTip')
  })

  test('the tab button with no valid amount asks for one at the amount field', async ({
    page,
  }) => {
    await open(page, 'tip-ready')
    const dialog = await openDialog(page, 'article')
    await chooseAmount(dialog, 'abc')
    await tabSection(dialog)
      .getByRole('button', { name: 'From your tab' })
      .click()
    await expect(dialog.getByLabel('Other amount')).toBeFocused()
    await expect(dialog.getByLabel('Other amount')).toHaveAttribute(
      'aria-invalid',
      'true'
    )
  })

  test('with a ready tab, the tab sends first and the wallet second', async ({
    page,
  }) => {
    await open(page, 'tip-ready')
    const dialog = await openDialog(page, 'article')
    await expect(tabSection(dialog)).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: 'From your wallet' })
    ).toBeVisible()
    // One primary action: the gate's own button steps down.
    await expect(
      dialog.getByRole('button', { name: 'Connect wallet' })
    ).toHaveCSS('background-color', 'rgb(249, 240, 226)')
    await dialog.getByRole('button', { name: 'Connect wallet' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a wallet' })
    await picker.getByRole('button', { name: /^Varial/ }).click()
    const wallet = dialog.getByRole('button', { name: 'Send from your wallet' })
    await expect(wallet).toBeVisible()
    await expect(wallet).toHaveClass(/tip-v2-secondary/)
    await expect(
      tabSection(dialog).getByRole('button', {
        name: 'Send $0.10 from your tab',
      })
    ).toHaveClass(/tip-primary/)
    // An amount the tab cannot send makes the wallet primary again.
    await chooseAmount(dialog, '0.75')
    const walletAgain = dialog.getByRole('button', { name: 'Send tip' })
    await expect(walletAgain).toHaveClass(/tip-primary/)
    await expect(
      tabSection(dialog).getByRole('button', {
        name: 'Send $0.75 from your tab',
      })
    ).toHaveCSS('opacity', '0.5')
  })

  test('a passage tip from the tab carries the passage', async ({ page }) => {
    await open(page, 'tip-accepted')
    const dialog = await openDialog(page, 'passage')
    const prepared = page.waitForRequest((r) =>
      r.url().includes('/api/prepareTip')
    )
    await sendFromTab(dialog)
    const body = (await prepared).postDataJSON() as {
      highlight?: { text: string } | null
    }
    expect(body.highlight?.text).toBe(
      'The quick brown fox jumps over the lazy dog'
    )
  })
})

// --- Keyboard, focus, motion ----------------------------------------------------

test.describe('keyboard and screen readers', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('a tab tip runs from the keyboard, and the result takes focus', async ({
    page,
    browserName,
  }) => {
    await open(page, 'tip-accepted')
    const dialog = await openDialog(page, 'article')
    const send = tabSection(dialog).getByRole('button', {
      name: 'Send $0.10 from your tab',
    })
    await expect(send).toBeVisible()
    // The dialog opens on its title. Safari's Tab skips buttons and links
    // with default settings; Option+Tab reaches them.
    const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    for (let i = 0; i < 20; i++) {
      if (await send.evaluate((el) => el === document.activeElement)) break
      await page.keyboard.press(next)
    }
    await expect(send).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      tabSection(dialog).getByText('Tip sent from your tab', { exact: true })
    ).toBeVisible()
    const focused = await page.evaluate(
      () => document.activeElement?.textContent
    )
    expect(focused).toContain('Tip sent from your tab')
    // Done closes the dialog.
    await tabSection(dialog).getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()
  })

  test('a tab tip started with a click moves focus to its result', async ({
    page,
  }) => {
    await open(page, 'tip-accepted')
    const dialog = await openDialog(page, 'article')
    await tabSection(dialog)
      .getByRole('button', { name: 'Send $0.10 from your tab' })
      .click()
    // Safari does not focus a button on click, so focus starts on the dialog.
    await expect(
      tabSection(dialog).locator('.pay-panel-title', {
        hasText: 'Tip sent from your tab',
      })
    ).toBeFocused()
  })

  test('the dialog cannot close while a tab tip is sending', async ({
    page,
  }) => {
    await open(page, 'tip-accepted')
    const dialog = await openDialog(page, 'article')
    await page.route('**/api/submitTip*', async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })
    await sendFromTab(dialog)
    // Held open from the press itself, not a render later.
    expect(await dialog.getAttribute('aria-busy')).toBe('true')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(
      tabSection(dialog).getByText('Tip sent from your tab', { exact: true })
    ).toBeVisible()
  })
})

test.describe('reduced motion', () => {
  test.use({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' })

  test('the tab section and its result do not animate', async ({ page }) => {
    await open(page, 'tip-accepted')
    const dialog = await openDialog(page, 'article')
    await sendFromTab(dialog)
    await expect(
      tabSection(dialog).getByText('Tip sent from your tab', { exact: true })
    ).toBeVisible()
    const running = await page.evaluate(
      () =>
        document
          .getAnimations()
          .filter(
            (a) =>
              a.playState === 'running' &&
              (a.effect as KeyframeEffect | null)?.target?.closest?.('.tip-tab')
          ).length
    )
    expect(running).toBe(0)
  })
})

// --- Widths and worst-case data --------------------------------------------------

for (const width of [320, 375, 768, 1440]) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })

    for (const variant of VARIANTS) {
      test(`${variant}: the ready section fits, with 44 px targets`, async ({
        page,
      }) => {
        await open(page, 'tip-ready')
        const dialog = await openDialog(page, variant)
        const send = tabSection(dialog).getByRole('button', {
          name: 'Send $0.10 from your tab',
        })
        await send.scrollIntoViewIfNeeded()
        expect((await send.boundingBox())!.height).toBeGreaterThanOrEqual(44)
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        const box = (await dialog.boundingBox())!
        expect(box.x).toBeGreaterThanOrEqual(0)
        expect(box.x + box.width).toBeLessThanOrEqual(width)
      })
    }

    test('worst-case names, passage and balance do not break the layout', async ({
      page,
    }) => {
      const errors = await open(page, 'dialog-large-balance', 'data=worst')
      for (const variant of VARIANTS) {
        const dialog = await openDialog(page, variant)
        await expect(tabSection(dialog)).toBeVisible()
        await expect(
          tabSection(dialog).getByText(
            /12,345,678,901\.2345678 XLM free|12345678901\.2345678 XLM free/
          )
        ).toBeVisible()
        expect(await overflow(page)).toBeLessThanOrEqual(0)
        const free = tabSection(dialog).locator('.tip-tab-free')
        const section = (await tabSection(dialog).boundingBox())!
        const freeBox = (await free.boundingBox())!
        expect(freeBox.x + freeBox.width).toBeLessThanOrEqual(
          section.x + section.width + 1
        )
        await shot(page, `worst-${variant}`)
        await page.keyboard.press('Escape')
        await expect(dialog).toBeHidden()
      }
      expect(errors).toEqual([])
    })

    test('the placeholder holds the height of the no-tab line', async ({
      page,
    }) => {
      await open(page, 'dialog-loading')
      let dialog = await openDialog(page, 'article')
      const placeholder = await dialog
        .locator('.tip-tab-loading')
        .evaluate((el) => el.getBoundingClientRect().height)
      await open(page, 'tip-no-tab')
      dialog = await openDialog(page, 'article')
      const link = dialog.getByRole('link', { name: 'Open a tab' })
      await expect(link).toBeVisible()
      const line = await dialog
        .locator('.tip-tab-line')
        .evaluate((el) => el.getBoundingClientRect().height)
      expect(Math.abs(line - placeholder)).toBeLessThanOrEqual(1)
      // The link keeps a 44 px target inside the line.
      expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    })

    test('a one-stroop balance says so with the amount', async ({ page }) => {
      await open(page, 'dialog-tiny-balance')
      const dialog = await openDialog(page, 'article')
      await expect(
        tabSection(dialog).getByText('0.0000001 XLM free', { exact: true })
      ).toBeVisible()
      await expect(
        tabSection(dialog).getByText('Not enough in your tab', { exact: true })
      ).toBeVisible()
      expect(await overflow(page)).toBeLessThanOrEqual(0)
    })
  })
}

test.describe('signed out', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('a signed-out reader sees no tab section; the dialog asks to sign in', async ({
    page,
  }) => {
    await open(page, 'tip-signed-out', 'auth=out')
    const dialog = await openDialog(page, 'article')
    await expect(dialog.getByRole('button', { name: /Sign in/ })).toBeVisible()
    await page.waitForTimeout(500)
    await expect(tabSection(dialog)).toHaveCount(0)
    await expect(dialog.getByText('Tip without a wallet prompt')).toHaveCount(0)
  })
})

// --- Review of #550: time, presets and refusals --------------------------------

/** The page's session id, for the stand-in backend. */
const sessionOf = (page: Page) =>
  new URL(page.url()).searchParams.get('session')!

/** Changes the tab's tip limits in the stand-in backend, as an update would. */
async function patchTipLimits(page: Page, patch: Record<string, unknown>) {
  const session = sessionOf(page)
  const state = await (
    await page.request.get(`/api/state?session=${session}`)
  ).json()
  await page.request.post(`/api/control?session=${session}`, {
    data: {
      patch: {
        tab: { ...state.tab, tipLimits: { ...state.tab.tipLimits, ...patch } },
      },
    },
  })
}

test.describe('the clock with the dialog open', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test("today's limit lifts at 00:00 UTC without a reload", async ({
    page,
  }) => {
    // 19.5 of 20 XLM accepted today: $0.10 (1 XLM) is over what is left.
    const day = new Date().toISOString().slice(0, 10)
    const beforeMidnight = Date.parse(`${day}T23:59:00.000Z`)
    await page.clock.install({ time: beforeMidnight })
    await open(page, 'dialog-daily-left')
    // The cached price was fetched a minute ago by this clock.
    await patchTipLimits(page, { priceFetchedAt: beforeMidnight - 60_000 })
    const dialog = await openDialog(page, 'article')
    const send = tabSection(dialog).getByRole('button', {
      name: 'Send $0.10 from your tab',
    })
    await expect(
      tabSection(dialog).getByText('This is over today’s tab limit', {
        exact: true,
      })
    ).toBeVisible()
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    await page.clock.fastForward('01:30')
    await expect(
      tabSection(dialog).getByText('This is over today’s tab limit', {
        exact: true,
      })
    ).toHaveCount(0)
    await expect(send).not.toHaveAttribute('aria-disabled', 'true')
  })

  test('a price that turns stale while the dialog is open is explained, and nothing is sent', async ({
    page,
  }) => {
    const start = Date.now()
    await page.clock.install({ time: start })
    await open(page, 'tip-ready')
    await patchTipLimits(page, { priceFetchedAt: start })
    const dialog = await openDialog(page, 'article')
    // The label follows the chosen amount, which the presets reset below.
    const send = tabSection(dialog).getByRole('button', {
      name: /^Send \$\d+\.\d\d from your tab$/,
    })
    await expect(send).not.toHaveAttribute('aria-disabled', 'true')
    await expect
      .poll(() => presets(dialog))
      .toEqual(['$0.10', '$0.25', '$0.50'])
    // Past prepare's 30-minute limit for a cached price.
    await page.clock.fastForward('30:01')
    await expect(
      tabSection(dialog).getByText('No XLM price right now', { exact: true })
    ).toBeVisible()
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    // With no tab maximum to follow, the presets are the wallet's again.
    await expect.poll(() => presets(dialog)).toEqual(['$1', '$2', '$5'])
    await send.click({ force: true })
    await page.waitForTimeout(300)
    expect((await backend(page)).calls).not.toContain('prepareTip')
  })

  test('a price stale at the press, before the page timer runs, sends nothing', async ({
    page,
  }) => {
    const start = Date.now()
    await page.clock.install({ time: start })
    await open(page, 'tip-ready')
    await patchTipLimits(page, { priceFetchedAt: start })
    const dialog = await openDialog(page, 'article')
    const send = tabSection(dialog).getByRole('button', {
      name: /^Send \$\d+\.\d\d from your tab$/,
    })
    await expect(send).not.toHaveAttribute('aria-disabled', 'true')
    // The clock passes the price's age without running timers, as in a
    // throttled background tab: only the check at the press can see it.
    // Pause first, so the page's own timer cannot fire before the press on a
    // slow runner, and press with a plain click event (Playwright's click
    // waits on animation frames, which a paused clock holds).
    await page.clock.pauseAt(start + 60_000)
    await page.clock.setSystemTime(start + 30 * 60 * 1000 + 5_000)
    await send.dispatchEvent('click')
    await expect(
      tabSection(dialog).getByText('No XLM price right now', { exact: true })
    ).toBeVisible()
    await expect(send).toHaveAttribute('aria-disabled', 'true')
    expect((await backend(page)).calls).not.toContain('prepareTip')
  })
})

test.describe('presets, headings and refusals', () => {
  test.use({ viewport: { width: 1440, height: 1000 } })

  test('presets do not follow a tab that cannot send here', async ({
    page,
  }) => {
    await open(page, 'tip-key-none')
    const dialog = await openDialog(page, 'article')
    await expect(
      tabSection(dialog).getByText('Quick tips aren’t set up on this device', {
        exact: true,
      })
    ).toBeVisible()
    await page.waitForTimeout(400)
    expect(await presets(dialog)).toEqual(['$1', '$2', '$5'])
    await expect(dialog.getByText(/Tab tips go up to/)).toHaveCount(0)
  })

  test('a pressed preset that no longer fits becomes the largest that does', async ({
    page,
  }) => {
    await open(page, 'tip-ready')
    const dialog = await openDialog(page, 'article')
    await dialog.getByRole('button', { name: '$0.50', exact: true }).click()
    await expect(
      tabSection(dialog).getByRole('button', {
        name: 'Send $0.50 from your tab',
      })
    ).toBeVisible()
    // The maximum drops to 2.5 XLM ($0.25).
    await patchTipLimits(page, { tipMax: '25000000', tipMaxCents: 25 })
    await expect
      .poll(() => presets(dialog))
      .toEqual(['$0.05', '$0.10', '$0.25'])
    await expect(
      dialog.getByRole('button', { name: '$0.25', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      tabSection(dialog).getByRole('button', {
        name: 'Send $0.25 from your tab',
      })
    ).toBeVisible()
  })

  test('the wallet keeps its heading when the tab is blocked', async ({
    page,
  }) => {
    await open(page, 'tip-ready')
    const dialog = await openDialog(page, 'article')
    await expect(
      dialog.getByRole('heading', { name: 'From your wallet' })
    ).toBeVisible()
    await chooseAmount(dialog, '0.75')
    await expect(
      tabSection(dialog).getByText('Tab tips go up to $0.50 right now', {
        exact: true,
      })
    ).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: 'From your wallet' })
    ).toBeVisible()
  })

  test('a refusal clears when the amount changes', async ({ page }) => {
    // The server refuses every quick tip with its daily limit.
    await open(page, 'tip-daily-limit')
    const dialog = await openDialog(page, 'article')
    await sendFromTab(dialog)
    const refusal = tabSection(dialog)
      .locator('.pay-panel')
      .getByText('Daily quick-tip limit reached', { exact: true })
    await expect(refusal).toBeVisible()
    await dialog.getByRole('button', { name: '$0.25', exact: true }).click()
    await expect(refusal).toHaveCount(0)
    await expect(
      tabSection(dialog).getByRole('button', {
        name: 'Send $0.25 from your tab',
      })
    ).toBeVisible()
  })
})
