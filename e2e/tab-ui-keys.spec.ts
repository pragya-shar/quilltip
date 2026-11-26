import { test, expect, type Page } from '@playwright/test'

/**
 * Quick tips from the tab (issue #449) in Chromium, Firefox and WebKit: the
 * session key, the voucher signature and the local ledger differ between
 * engines. Same fixture as e2e/tab-ui.spec.ts (port 4183).
 */

async function open(page: Page, id: string, session?: string) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`/?state=${id}${session ? `&session=${session}` : ''}`)
  await expect(page.getByTestId('fixture-state')).toBeVisible()
  return errors
}

const tipButton = (page: Page) =>
  page.getByRole('button', { name: /from tab$/ })
const text = (page: Page, t: string | RegExp) =>
  page.locator('.tab-ui').getByText(t).first()

async function tip(page: Page) {
  await expect(tipButton(page)).toBeEnabled()
  await tipButton(page).click()
}

test('tips with no wallet prompt: accepted, then settled', async ({ page }) => {
  const errors = await open(page, 'tip-ready')
  await expect(text(page, /No wallet prompt/)).toBeVisible()
  await tip(page)
  await expect(text(page, 'Tip sent from your tab')).toBeVisible()
  await expect(text(page, 'Tip settled')).toBeVisible({ timeout: 10_000 })
  await expect(
    page.getByRole('link', { name: /View the transaction/ })
  ).toBeVisible()
  expect(errors).toEqual([])
})

const RESULTS: Array<[string, string]> = [
  ['tip-accepted', 'Tip sent from your tab'],
  ['tip-shortfall', 'Waiting for the tab balance'],
  ['tip-unpaid', 'Not paid'],
  ['tip-rejected', 'Not settled'],
  ['tip-void', 'Cleared by a testnet reset'],
]
for (const [id, title] of RESULTS) {
  test(`tab tip result: ${id}`, async ({ page }) => {
    await open(page, id)
    await tip(page)
    await expect(page.getByRole('heading', { name: title })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
  })
}

test('a lost response resubmits the same voucher and is accepted once', async ({
  page,
}) => {
  await open(page, 'tip-lost-response')
  await tip(page)
  await expect(text(page, 'Tip sent from your tab')).toBeVisible({
    timeout: 15_000,
  })
  const calls = await page.evaluate(() =>
    (
      window as unknown as {
        tabFixture: {
          snapshot(): { calls: string[]; tab: { outstanding: string } }
        }
      }
    ).tabFixture.snapshot()
  )
  expect(calls.calls.filter((c) => c === 'submitTip').length).toBe(2)
  expect(calls.calls.filter((c) => c === 'prepareTip').length).toBe(1)
  expect(calls.tab.outstanding).toBe('25000000')
})

test('a stale submit prepares once more and is accepted', async ({ page }) => {
  await open(page, 'tip-stale')
  await tip(page)
  await expect(text(page, /Tip sent from your tab|Tip settled/)).toBeVisible({
    timeout: 10_000,
  })
  const calls = await page.evaluate(
    () =>
      (
        window as unknown as { tabFixture: { snapshot(): { calls: string[] } } }
      ).tabFixture.snapshot().calls
  )
  expect(calls.filter((c) => c === 'prepareTip').length).toBe(2)
})

const REFUSALS: Array<[string, string]> = [
  ['tip-over-balance', 'Not enough in your tab'],
  ['tip-key-limit', 'This device reached its quick-tip limit'],
  ['tip-receipt-cap', 'This device reached its quick-tip limit'],
  ['tip-daily-limit', 'Daily quick-tip limit reached'],
  ['tip-above-max', 'This tip is above the quick-tip maximum'],
]
for (const [id, title] of REFUSALS) {
  test(`refusal before anything is paid: ${id}`, async ({ page }) => {
    await open(page, id)
    await tip(page)
    await expect(text(page, title)).toBeVisible()
  })
}

test('the tip action offers the wallet for an article with co-authors', async ({
  page,
}) => {
  await open(page, 'tip-splits')
  await expect(tipButton(page)).toHaveCount(0)
  await page.getByRole('button', { name: 'Tip from wallet' }).click()
  await expect(page.locator('body')).toHaveAttribute(
    'data-wallet-tip',
    'opened'
  )
})

test('two browser tabs tipping at once: both land, one after a retry, the pair advances by two', async ({
  context,
  page,
}) => {
  const session = `two-tabs-${Date.now()}`
  await open(page, 'tip-two-tabs', session)
  await expect(tipButton(page)).toBeEnabled()
  const other = await context.newPage()
  await open(other, 'tip-two-tabs', session)
  await expect(tipButton(other)).toBeEnabled()
  await Promise.all([tipButton(page).click(), tipButton(other).click()])
  for (const p of [page, other]) {
    await expect(text(p, 'Tip sent from your tab')).toBeVisible({
      timeout: 15_000,
    })
  }
  const snapshot = await page.evaluate(() =>
    (
      window as unknown as {
        tabFixture: {
          snapshot(): { tab: { outstanding: string }; calls: string[] }
        }
      }
    ).tabFixture.snapshot()
  )
  // Two tips of 25 cents (2.5 XLM each) accepted, never more.
  expect(snapshot.tab.outstanding).toBe('50000000')
  expect(
    snapshot.calls.filter((c) => c === 'submitTip').length
  ).toBeGreaterThanOrEqual(2)
})
