/**
 * The passage tip from the balance, the balance and the earnings screens on
 * the real payments provider, hooks and views, over the balance fixture's
 * stand-in backend (`e2e/fixtures/balance/`). Every state at phone, tablet
 * and desktop width; the exactly-once cases (double tap, reload during send,
 * reopen, sign-out mid-send); and that a drag across prose never pays.
 */
import { expect, test, type Page } from '@playwright/test'

type Backend = {
  receipts: Array<{ requestId: string; reader: string; status: string }>
  calls: { prepare: number; submit: number; refused: number }
  user: string | null
}

let runSeq = 0
async function open(
  page: Page,
  screen: 'tip' | 'balance' | 'earnings' | 'app',
  seed: string,
  run = `${Date.now()}-${++runSeq}`,
  extra = ''
) {
  await page.goto(`/?screen=${screen}&seed=${seed}&run=${run}${extra}`)
  return run
}

const backend = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __fixture: { state(): Backend } }).__fixture.state()
  )
const control = (page: Page, name: string, ...args: unknown[]) =>
  page.evaluate(
    ([n, a]) =>
      (
        (
          window as unknown as {
            __fixture: Record<string, (...x: unknown[]) => void>
          }
        ).__fixture[n as string] as (...x: unknown[]) => void
      )(...(a as unknown[])),
    [name, args] as const
  )

/** Selects the first sentence of the second paragraph, as a reader would. */
async function choosePassage(page: Page, options: { live?: boolean } = {}) {
  const bar = page.getByRole('region', { name: 'Tip this passage' })
  // The page may still be attaching its listeners: select until the bar shows.
  await expect(async () => {
    await page.evaluate(() => {
      const p = document.querySelectorAll('[data-testid="article-body"] p')[1]!
      const text = p.firstChild!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 'Leave it overnight.'.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('pointerup', { bubbles: true }))
    })
    await expect(bar).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  // Unless the test taps early on purpose, wait until the control is live.
  if (options.live !== false)
    await expect(bar.locator('.qt-tip')).toHaveAttribute('data-live', 'true')
  return bar
}

/** Selects the passage while signed out, until the control answers. */
async function choosePassageSignedOut(page: Page) {
  const unavailable = page.getByTestId('tip-unavailable')
  await expect(async () => {
    await page.evaluate(() => {
      const p = document.querySelectorAll('[data-testid="article-body"] p')[1]!
      const range = document.createRange()
      range.setStart(p.firstChild!, 0)
      range.setEnd(p.firstChild!, 'Leave it overnight.'.length)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new Event('pointerup', { bubbles: true }))
    })
    await expect(unavailable).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
}

const tipButton = (page: Page) =>
  page.getByRole('region', { name: 'Tip this passage' }).getByRole('button', {
    name: /^(Tip this line|Sending|Sent|Try again|Offline)/,
  })

test.describe('passage tip from the balance', () => {
  test('one tap sends at once, says Sent only after acceptance, and the balance drops at once', async ({
    page,
  }, info) => {
    await open(page, 'tip', 'reader-slow')
    const bar = await choosePassage(page)
    const status = bar.getByRole('status')
    await expect(status).toHaveText('≈ $7.00 ready to tip.')
    await expect(tipButton(page)).toHaveText('Tip this line $1')
    await tipButton(page).click()
    // Sending: nothing is final yet, and the figure dropped at once.
    await expect(tipButton(page)).toHaveText('Sending $1')
    await expect(status).toContainText(
      'Sending $1 to Ada Lovelace. ≈ $6.00 ready to tip.'
    )
    await page.screenshot({ path: info.outputPath('tip-sending.png') })
    await expect(tipButton(page)).toHaveText('Sent $1', { timeout: 10_000 })
    await expect(status).toContainText(
      'You tipped Ada Lovelace $1. Tips are final. ≈ $6.00 ready to tip.'
    )
    await page.screenshot({ path: info.outputPath('tip-sent.png') })
    const state = await backend(page)
    expect(state.receipts).toHaveLength(1)
    // The passage is still on screen, above the bar.
    const passage = await page.evaluate(() => {
      const p = document.querySelectorAll('[data-testid="article-body"] p')[1]!
      return p.getBoundingClientRect().top
    })
    const barTop = (await bar.boundingBox())!.y
    expect(passage).toBeLessThan(barTop)
  })

  test('a double tap sends one tip', async ({ page }) => {
    await open(page, 'tip', 'reader-slow')
    await choosePassage(page)
    await tipButton(page).dblclick()
    // A third tap while it is sending (the button reads aria-disabled).
    await tipButton(page).dispatchEvent('click')
    await expect(tipButton(page)).toHaveText('Sent $1', { timeout: 10_000 })
    const state = await backend(page)
    expect(state.receipts).toHaveLength(1)
    expect(state.calls.submit).toBe(1)
  })

  test('changes the amount by tap and by keyboard, and sends that amount', async ({
    page,
  }) => {
    await open(page, 'tip', 'reader-ready')
    const bar = await choosePassage(page)
    await bar.getByRole('button', { name: 'Change amount' }).click()
    const amounts = bar.getByRole('group', { name: 'Amount' })
    await expect(amounts.getByRole('radio')).toHaveCount(4)
    await amounts.getByRole('radio', { name: '$3' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(tipButton(page)).toHaveText('Tip this line $5')
    await bar.getByRole('button', { name: 'Change amount' }).click()
    await bar.getByRole('radio', { name: '$2' }).click()
    await expect(tipButton(page)).toHaveText('Tip this line $2')
    await tipButton(page).focus()
    await page.keyboard.press('Enter')
    await expect(tipButton(page)).toHaveText('Sent $2', { timeout: 10_000 })
  })

  test('a balance below the smallest amount and offline send nothing', async ({
    page,
    context,
  }, info) => {
    await open(page, 'tip', 'reader-broke') // 7 cents
    const bar = await choosePassage(page)
    await expect(tipButton(page)).toHaveText('Tip this line')
    await expect(bar.getByRole('status')).toContainText(
      'Your balance is too low for a tip.'
    )
    await expect(bar.getByRole('link', { name: 'Add money' })).toBeVisible()
    await tipButton(page).click()
    await expect(bar.getByRole('status')).toContainText('You have ≈ $0.07.')
    await page.screenshot({ path: info.outputPath('tip-needs-funds.png') })
    expect((await backend(page)).calls.prepare).toBe(0)
    await open(page, 'tip', 'reader-ready')
    await choosePassage(page)
    await context.setOffline(true)
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveText('Offline')
    await page.screenshot({ path: info.outputPath('tip-offline.png') })
    await context.setOffline(false)
    expect((await backend(page)).calls.prepare).toBe(0)
  })

  test('a 63-cent cap offers 10, 25 and 50 cents, defaults to 10, and charges what the button says', async ({
    page,
  }) => {
    const run = await open(page, 'tip', 'reader-capped')
    const bar = await choosePassage(page)
    await expect(tipButton(page)).toHaveText('Tip this line $0.10')
    await bar.getByRole('button', { name: 'Change amount' }).click()
    const radios = bar.getByRole('group', { name: 'Amount' }).getByRole('radio')
    expect(
      await radios.evaluateAll((els) =>
        els.map((e) => (e as HTMLInputElement).value)
      )
    ).toEqual(['10', '25', '50'])
    await bar.getByRole('button', { name: 'Change amount' }).click()
    for (const [cents, label] of [
      [10, '$0.10'],
      [25, '$0.25'],
      [50, '$0.50'],
    ] as const) {
      if (!(await bar.getByRole('group', { name: 'Amount' }).isVisible()))
        await bar.getByRole('button', { name: 'Change amount' }).click()
      await bar.getByRole('radio', { name: label }).dispatchEvent('click')
      if (await bar.getByRole('group', { name: 'Amount' }).isVisible())
        await bar.getByRole('button', { name: 'Change amount' }).click()
      await expect(tipButton(page)).toHaveText(`Tip this line ${label}`)
      await tipButton(page).click()
      await expect(tipButton(page)).toHaveText(`Sent ${label}`, {
        timeout: 10_000,
      })
      const receipts = (await backend(page)).receipts as unknown as Array<{
        amountCents: number
      }>
      expect(receipts[receipts.length - 1]!.amountCents).toBe(cents)
      await expect(tipButton(page)).toHaveText(/^Tip this line/, {
        timeout: 5_000,
      })
    }
    // The activity rows show the same cents the buttons said.
    await open(page, 'balance', 'reader-capped', run)
    await expect(
      page.getByTestId('activity-row').locator('.qt-row-amount')
    ).toHaveText(['$0.50', '$0.25', '$0.10'])
  })

  test('a refused tip says so and charges nothing', async ({ page }, info) => {
    await open(page, 'tip', 'reader-refused')
    const bar = await choosePassage(page)
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveText('Try again', { timeout: 10_000 })
    await expect(bar.getByRole('status')).toHaveText(
      'That tip did not go through. You were not charged.'
    )
    await page.screenshot({ path: info.outputPath('tip-failed.png') })
    expect((await backend(page)).receipts).toHaveLength(0)
  })

  test('a drag across a paragraph sends nothing; the button then tips the line', async ({
    page,
  }) => {
    await open(page, 'tip', 'reader-ready')
    const p = page.locator('[data-testid="article-body"] p').nth(2)
    const box = (await p.boundingBox())!
    // A horizontal drag across the prose, by mouse.
    await page.mouse.move(box.x + 4, box.y + 10)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 4, box.y + 12, { steps: 12 })
    await page.mouse.up()
    expect((await backend(page)).calls.prepare).toBe(0)
    expect((await backend(page)).receipts).toHaveLength(0)
    // The drag chose a passage; only the labelled button sends.
    await expect(tipButton(page)).toHaveText(/^Tip this line \$1$/)
    await expect(tipButton(page)).toHaveAttribute('data-live', 'true')
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveText('Sent $1', { timeout: 10_000 })
    expect((await backend(page)).receipts).toHaveLength(1)
  })

  test('a reload during the send keeps the tip, exactly once', async ({
    page,
  }) => {
    const run = await open(page, 'tip', 'reader-slow')
    await choosePassage(page)
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveText('Sending $1')
    // Reload while the submit is in flight; the same backend survives.
    await expect
      .poll(async () => (await backend(page)).calls.submit)
      .toBeGreaterThan(0)
    await open(page, 'balance', 'reader-slow', run)
    const rows = page.getByTestId('activity-row')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText(/Sending|Sent/)
    await expect(rows.first()).toContainText('Sent', { timeout: 15_000 })
    const state = await backend(page)
    expect(state.receipts).toHaveLength(1)
    // Reopen in a new page with the same storage: still once.
    const again = await page.context().newPage()
    await open(again, 'balance', 'reader-slow', run)
    await expect(again.getByTestId('activity-row')).toHaveCount(1)
    await expect(again.getByTestId('balance-available')).toHaveText('≈ $6.00')
  })

  test('sign-out mid-send keeps reader A apart from reader B, and A gets the tip once', async ({
    page,
  }) => {
    const run = await open(page, 'tip', 'two-readers')
    await control(page, 'latency', 2_500)
    await choosePassage(page)
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveText('Sending $1')
    // Signed and sent: the submit is in flight when the reader signs out.
    await expect
      .poll(async () => (await backend(page)).calls.submit)
      .toBeGreaterThan(0)
    await control(page, 'signOut')
    await expect(
      page.getByRole('region', { name: 'Tip this passage' })
    ).toHaveCount(0)
    await control(page, 'signIn', 'b')
    await open(page, 'balance', 'two-readers', run)
    // B sees nothing of A: no row, A's tip not off B's balance.
    await expect(page.getByTestId('balance-available')).toHaveText('≈ $3.50')
    await expect(page.getByText('Your tips show up here.')).toBeVisible()
    await control(page, 'latency', 100)
    await control(page, 'signIn', 'a')
    await page.reload()
    await expect(page.getByTestId('activity-row')).toHaveCount(1)
    await expect(page.getByTestId('activity-row').first()).toContainText(
      'Sent',
      {
        timeout: 15_000,
      }
    )
    const state = await backend(page)
    expect(state.receipts.filter((r) => r.reader === 'a')).toHaveLength(1)
    expect(state.receipts.filter((r) => r.reader === 'b')).toHaveLength(0)
  })
})

test.describe('balance screen', () => {
  for (const [seed, name] of [
    ['reader-history', 'history'],
    ['reader-empty', 'empty'],
    ['reader-none', 'no-balance'],
    ['loading', 'loading'],
  ] as const) {
    test(`renders the ${name} state`, async ({ page }, info) => {
      await open(page, 'balance', seed)
      await expect(
        page.getByRole('heading', { name: 'Ready to tip' })
      ).toBeVisible()
      if (name === 'history') {
        await expect(page.getByTestId('activity-row')).toHaveCount(4)
        await expect(
          page.getByText('Did not complete', { exact: true })
        ).toBeVisible()
        await expect(page.getByText('On hold')).toBeVisible()
        await expect(
          page.getByText('Added to earnings', { exact: true })
        ).toBeVisible()
        await page
          .getByTestId('activity-row')
          .nth(1)
          .getByRole('button')
          .click()
        await expect(page.getByText('Exact amount')).toBeVisible()
      }
      if (name === 'empty')
        await expect(page.getByText('Your tips show up here.')).toBeVisible()
      if (name === 'no-balance')
        await expect(
          page.getByText('Add money once, then tip with one tap.')
        ).toBeVisible()
      if (name === 'loading')
        await expect(page.getByLabel('Loading your balance')).toBeVisible()
      const words = (await page.locator('body').innerText()).toLowerCase()
      for (const banned of [
        'voucher',
        'settle',
        'session key',
        'stroops',
        'contract',
      ])
        expect(words).not.toContain(banned)
      expect(words.split('testnet').length - 1).toBeLessThanOrEqual(1)
      await page.screenshot({
        path: info.outputPath(`balance-${name}.png`),
        fullPage: true,
      })
    })
  }

  test('shows offline plainly', async ({ page, context }) => {
    await open(page, 'balance', 'reader-history')
    await context.setOffline(true)
    await expect(
      page.getByText('You are offline. These figures may be out of date.')
    ).toBeVisible()
    await context.setOffline(false)
  })
})

test.describe('earnings screen', () => {
  for (const [seed, name] of [
    ['writer-pending', 'pending'],
    ['writer-lagging', 'lagging'],
    ['writer-available', 'available'],
    ['writer-collected', 'collected'],
    ['writer-failed', 'failed'],
    ['writer-empty', 'empty'],
    ['loading', 'loading'],
  ] as const) {
    test(`renders the ${name} state`, async ({ page }, info) => {
      await open(page, 'earnings', seed)
      await expect(
        page.getByRole('heading', { name: 'Ready to withdraw' })
      ).toBeVisible()
      const pending = page.getByTestId('earnings-pending')
      const available = page.getByTestId('earnings-available')
      if (name === 'pending') {
        await expect(pending).toHaveText('$3.90')
        await expect(available).toHaveText('$0.00')
        await expect(page.getByText('A reader').first()).toBeVisible()
      }
      if (name === 'lagging')
        await expect(page.getByTestId('earnings-lagging')).toBeVisible()
      if (name === 'available') {
        await expect(available).toHaveText('$2.925')
        await expect(pending).toHaveText('$0.975')
      }
      if (name === 'collected') {
        await expect(available).toHaveText('$0.975')
        await expect(page.getByTestId('earnings-collected')).toHaveText('$1.95')
      }
      if (name === 'failed') {
        await expect(page.getByTestId('earnings-on-hold')).toContainText(
          '1 tip on hold'
        )
        await expect(page.getByTestId('earnings-not-paid')).toContainText(
          '1 tip did not complete'
        )
        await expect(page.getByText('No one was charged')).toHaveCount(0)
        // A failed payout never shows as available.
        await expect(available).toHaveText('$0.975')
      }
      if (name === 'empty')
        await expect(
          page.getByText('Tips you receive show up here.')
        ).toBeVisible()
      const words = (await page.locator('body').innerText()).toLowerCase()
      for (const banned of [
        'voucher',
        'settle',
        'session key',
        'stroops',
        'contract',
        'readers tipped',
        'supporters',
      ])
        expect(words).not.toContain(banned)
      await page.screenshot({
        path: info.outputPath(`earnings-${name}.png`),
        fullPage: true,
      })
    })
  }
})

test.describe('a signed-out visitor', () => {
  test('sees a tip amount from public terms only, then the reader’s own once signed in', async ({
    page,
  }) => {
    const run = await open(page, 'tip', 'signed-out')
    await choosePassageSignedOut(page)
    const unavailable = page.getByTestId('tip-unavailable')
    await expect(unavailable).toHaveText('Unavailable: signed-out')
    // Public terms: the ladder within the cap, $1 by default.
    await expect(unavailable).toHaveAttribute('data-amount', '$1.00')
    await expect(unavailable).toHaveAttribute(
      'data-amounts',
      '$1.00 $2.00 $3.00 $5.00'
    )
    // Signed in: the amounts are the reader's own (balance and day).
    await control(page, 'signIn', 'a')
    await expect(tipButton(page)).toHaveText(/Tip this line \$1$/, {
      timeout: 10_000,
    })
    void run
  })
})

test.describe('states the ledger can reach', () => {
  test('a reader who spent outside the app sees zero to tip and no amount that fits', async ({
    page,
  }) => {
    await open(page, 'balance', 'reader-overdrawn')
    await expect(page.getByTestId('balance-available')).toHaveText('≈ $0.00')
    await open(page, 'tip', 'reader-overdrawn')
    const bar = await choosePassage(page)
    await expect(bar.getByRole('status')).toContainText(
      'Your balance is too low for a tip.'
    )
  })

  test('tips on hold for an empty reader balance are on hold, not on their way', async ({
    page,
  }) => {
    await open(page, 'earnings', 'writer-held-reader-empty')
    await expect(page.getByTestId('earnings-pending')).toHaveText('$0.00')
    await expect(page.getByTestId('earnings-available')).toHaveText('$0.00')
    await expect(page.getByTestId('earnings-on-hold')).toContainText(
      '2 tips on hold'
    )
  })
})

test.describe('earnings rows and their total', () => {
  test('three tips of 50¢, 10¢ and 10¢: rows as sent, exact shares, one total', async ({
    page,
  }) => {
    await open(page, 'earnings', 'writer-three')
    await expect(page.getByTestId('earnings-available')).toHaveText('$0.6825')
    const rows = page.getByTestId('activity-row')
    await expect(rows.locator('.qt-row-amount')).toHaveText([
      '$0.10',
      '$0.10',
      '$0.50',
    ])
    await expect(rows.locator('.qt-status')).toHaveText([
      'Added to earnings',
      'Added to earnings',
      'Added to earnings',
    ])
    for (let i = 0; i < 3; i++) await rows.nth(i).getByRole('button').click()
    await expect(rows.getByTestId('row-share')).toHaveText([
      '$0.0975 (you keep 97.5%)',
      '$0.0975 (you keep 97.5%)',
      '$0.4875 (you keep 97.5%)',
    ])
    await expect(page.getByTestId('earnings-rows-note')).toContainText(
      'Your earnings are 97.5% of each tip'
    )
    // Settled tips are never called paid to the wallet; only collected money is.
    await expect(rows.getByText(/Paid to/)).toHaveCount(0)
  })

  test('the total is the exact sum of the shares', async ({ page }) => {
    // Seven shares of $0.0975: the figure is their exact sum.
    await open(page, 'earnings', 'writer-seven')
    await expect(page.getByTestId('earnings-available')).toHaveText('$0.6825')
    const rows = page.getByTestId('activity-row')
    await expect(rows).toHaveCount(7)
    await expect(rows.locator('.qt-row-amount')).toHaveText(
      Array(7).fill('$0.10')
    )
  })

  test('the reader sees the same states in their words', async ({ page }) => {
    await open(page, 'balance', 'reader-history')
    const rows = page.getByTestId('activity-row')
    await expect(rows.getByText('Added to earnings')).toHaveCount(1)
    await expect(rows.getByText(/^Paid$/)).toHaveCount(0)
  })
})

test.describe('payments never take reading with them', () => {
  for (const fault of ['missing', 'throwing'] as const) {
    test(`the feed, an article and navigation work while balance:session is ${fault}, and payments recover`, async ({
      page,
    }) => {
      const run = await open(page, 'app', 'signed-out')
      await page.goto(`/articles?screen=app&seed=signed-out&run=${run}`)
      await expect(
        page.getByRole('heading', { name: 'Story time.' })
      ).toBeVisible()
      await control(page, 'sessionFault', fault)
      await page.getByRole('button', { name: 'Sign in' }).click()
      // Signed in, the query fails: the page stays.
      await expect(
        page.getByRole('heading', { name: 'Story time.' })
      ).toBeVisible()
      await expect(page.getByTestId('app-fallback')).toHaveCount(0)
      await page.getByRole('link', { name: 'Leave It Overnight' }).click()
      await expect(
        page.getByRole('heading', { name: 'Leave It Overnight' })
      ).toBeVisible()
      const bar = await choosePassage(page, { live: false })
      await expect(bar.getByRole('status')).toHaveText(
        'Tipping is unavailable right now. Reading is not affected.',
        { timeout: 10_000 }
      )
      await page.getByRole('link', { name: 'Balance' }).click()
      await expect(page.getByTestId('balance-unavailable')).toBeVisible()
      await page.getByRole('link', { name: 'Articles' }).click()
      await expect(
        page.getByRole('heading', { name: 'Story time.' })
      ).toBeVisible()
      // The backend catches up: payments recover without a reload.
      await control(page, 'sessionFault', null)
      await page.getByRole('link', { name: 'Balance' }).click()
      await expect(page.getByTestId('balance-available')).toHaveText(
        '≈ $7.00',
        {
          timeout: 15_000,
        }
      )
      await expect(page.getByTestId('app-fallback')).toHaveCount(0)
    })
  }

  test('a tip that fails leaves the article and the passage in place', async ({
    page,
  }) => {
    await open(page, 'tip', 'reader-refused')
    await page.evaluate(() => window.scrollTo(0, 120))
    const before = await page.evaluate(() => window.scrollY)
    const bar = await choosePassage(page)
    await tipButton(page).click()
    await expect(tipButton(page)).toHaveText('Try again', { timeout: 10_000 })
    await expect(bar.getByRole('status')).toHaveText(
      'That tip did not go through. You were not charged.'
    )
    await expect(
      page.getByRole('heading', { name: 'Leave It Overnight' })
    ).toBeVisible()
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      'Leave it overnight.'
    )
    expect(await page.evaluate(() => window.scrollY)).toBe(before)
  })

  test('a tap before the payments code is ready sends exactly one tip', async ({
    page,
  }) => {
    await open(page, 'tip', 'reader-ready', undefined, '&engineDelay=2500')
    const bar = await choosePassage(page, { live: false })
    await expect(tipButton(page)).toHaveText('Tip this line $1')
    await tipButton(page).click()
    await tipButton(page).click()
    await expect(bar.getByRole('status')).toHaveText(
      'Getting ready. Your tip goes in a moment.'
    )
    expect((await backend(page)).calls.prepare).toBe(0)
    await expect(tipButton(page)).toHaveText('Sent $1', { timeout: 15_000 })
    const state = await backend(page)
    expect(state.receipts).toHaveLength(1)
    expect(state.calls.prepare).toBe(1)
  })
})

/** WCAG contrast of each element's text against the background behind it. */
async function contrasts(page: Page, selectors: string[]) {
  return page.evaluate((sels) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const rgb = (color: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000'
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return { r: r!, g: g!, b: b!, a: a! / 255 }
    }
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const c = v / 255
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const background = (el: Element | null): string => {
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor
        if (rgb(bg).a > 0.5) return bg
      }
      return getComputedStyle(document.body).backgroundColor || '#fff'
    }
    const out: Record<string, number> = {}
    for (const sel of sels) {
      const el = document.querySelector(sel)
      if (!el) continue
      const fg = lum(rgb(getComputedStyle(el).color))
      const bg = lum(rgb(background(el)))
      out[sel] = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05)
    }
    return out
  }, selectors)
}

test.describe('contrast and partly paid tips', () => {
  test('text and controls on both screens meet 4.5:1', async ({ page }) => {
    await open(page, 'balance', 'reader-history')
    await expect(page.getByTestId('balance-available')).toBeVisible()
    const balance = await contrasts(page, [
      '.qt-figure',
      '.qt-figure-label',
      '.qt-testnet',
      'a.qt-button',
      '.qt-row-title',
      '.qt-status',
    ])
    await open(page, 'earnings', 'writer-failed')
    await expect(page.getByTestId('earnings-available')).toBeVisible()
    const earnings = await contrasts(page, [
      '.qt-figure',
      '.qt-figure-label',
      '.qt-lines dt',
      '.qt-notice',
      '.qt-status',
    ])
    for (const [sel, ratio] of Object.entries({ ...balance, ...earnings }))
      expect(ratio, sel).toBeGreaterThanOrEqual(4.5)
  })

  test('a partly paid tip says what was paid, on both screens', async ({
    page,
  }) => {
    await open(page, 'balance', 'reader-partial')
    const rows = page.getByTestId('activity-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Paid in part')
    await rows.nth(0).getByRole('button').click()
    await expect(
      page.getByText('$0.10 was paid. $0.15 is back in your balance.')
    ).toBeVisible()
    await rows.nth(1).getByRole('button').click()
    await expect(
      page.getByText(
        '$0.10 was paid. $0.15 waits on your balance; add money and it goes through.'
      )
    ).toBeVisible()
    await open(page, 'earnings', 'writer-partial')
    const wrows = page.getByTestId('activity-row')
    // The row states the tip as sent; the detail states exact amounts.
    await expect(wrows.nth(1).locator('.qt-row-amount')).toHaveText('$0.25')
    await wrows.nth(1).getByRole('button').click()
    await expect(
      page.getByText(
        "$0.0975 arrived. $0.14625 is waiting on the reader's balance."
      )
    ).toBeVisible()
    await expect(page.getByText(/not charged/)).toHaveCount(0)
  })
})

test.describe('figures appear only when read', () => {
  const CURRENCY = /\$\s?\d|<\$0\.01/

  test('an outage shows no dollar figure of any kind on either screen', async ({
    page,
  }) => {
    await open(page, 'balance', 'reader-outage')
    await expect(page.getByTestId('balance-unavailable')).toBeVisible({
      timeout: 10_000,
    })
    expect(await page.locator('body').innerText()).not.toMatch(CURRENCY)
    await open(page, 'earnings', 'writer-outage')
    await expect(page.getByTestId('earnings-unavailable')).toBeVisible({
      timeout: 10_000,
    })
    expect(await page.locator('body').innerText()).not.toMatch(CURRENCY)
  })

  test('loading shows skeletons in place of every figure, and no figure', async ({
    page,
  }) => {
    await open(page, 'balance', 'loading')
    await expect(page.getByLabel('Loading your balance')).toBeVisible()
    expect(await page.locator('body').innerText()).not.toMatch(CURRENCY)
    await open(page, 'earnings', 'loading')
    await expect(page.getByLabel('Loading your earnings')).toBeVisible()
    await expect(
      page.getByTestId('earnings-pending').getByLabel('Loading')
    ).toBeVisible()
    await expect(
      page.getByTestId('earnings-collected').getByLabel('Loading')
    ).toBeVisible()
    expect(await page.locator('body').innerText()).not.toMatch(CURRENCY)
  })

  test('a confirmed empty account shows real zeros', async ({ page }) => {
    await open(page, 'earnings', 'writer-empty')
    await expect(page.getByTestId('earnings-available')).toHaveText('$0.00')
    await expect(page.getByTestId('earnings-pending')).toHaveText('$0.00')
    await expect(page.getByTestId('earnings-collected')).toHaveText('$0.00')
    await open(page, 'balance', 'reader-none')
    await expect(page.getByTestId('balance-available')).toHaveText('≈ $0.00')
  })
})
