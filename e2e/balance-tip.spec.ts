/**
 * The passage tip from the balance, the balance and the earnings screens on
 * the real payments provider, hooks and views, over the balance fixture's
 * stand-in backend (`e2e/fixtures/balance/`). Every state at phone, tablet
 * and desktop width; the exactly-once cases (double tap, reload during send,
 * reopen, sign-out mid-send); and D11: a drag across prose never pays.
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
  screen: 'tip' | 'balance' | 'earnings',
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
    await expect(status).toHaveText('$7.00 ready to tip.')
    await expect(tipButton(page)).toHaveText('Tip this line $1')
    await tipButton(page).click()
    // Sending: nothing is final yet, and the figure dropped at once.
    await expect(tipButton(page)).toHaveText('Sending $1')
    await expect(status).toContainText(
      'Sending $1 to Ada Lovelace. $6.00 ready to tip.'
    )
    await page.screenshot({ path: info.outputPath('tip-sending.png') })
    await expect(tipButton(page)).toHaveText('Sent $1', { timeout: 10_000 })
    await expect(status).toContainText(
      'You tipped Ada Lovelace $1. Tips are final. $6.00 ready to tip.'
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
    await expect(bar.getByRole('status')).toContainText('You have $0.07.')
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

  test('a drag across a paragraph sends nothing; the button then tips the line (D11)', async ({
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
    await expect(again.getByTestId('balance-available')).toHaveText('$6.00')
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
    await expect(page.getByTestId('balance-available')).toHaveText('$3.50')
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
        await expect(page.getByText('Did not go through')).toBeVisible()
        await expect(page.getByText('On hold')).toBeVisible()
        await expect(page.getByText('Paid', { exact: true })).toBeVisible()
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
        page.getByRole('heading', { name: 'Available' })
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
        await expect(available).toHaveText('$2.92')
        await expect(pending).toHaveText('$0.97')
      }
      if (name === 'collected') {
        await expect(available).toHaveText('$0.97')
        await expect(page.getByTestId('earnings-collected')).toHaveText('$1.95')
      }
      if (name === 'failed') {
        await expect(page.getByTestId('earnings-on-hold')).toContainText(
          '1 tip on hold'
        )
        await expect(page.getByTestId('earnings-not-paid')).toContainText(
          '1 tip did not complete'
        )
        // A failed payout never shows as available.
        await expect(available).toHaveText('$0.97')
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
      await expect(page.getByTestId('balance-available')).toHaveText('$7.00', {
        timeout: 15_000,
      })
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
