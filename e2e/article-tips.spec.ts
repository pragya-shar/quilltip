import { test, expect, type Page } from '@playwright/test'
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
 * Article registration, anchor updates and the wallet move, through the real
 * tips panel, action runner, call encoder, wallet runtime and Wallets Kit,
 * against an emulated Varial extension that signs with a throwaway key. The
 * fixture stands in for Convex and Stellar RPC; nothing leaves the page.
 *
 *   bun e2e/fixtures/article-tips/server.mjs
 *   ARTICLE_TIPS_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4178 bunx playwright test e2e/article-tips.spec.ts
 */
test.skip(
  process.env.ARTICLE_TIPS_FIXTURES !== '1',
  'Start e2e/fixtures/article-tips/server.mjs and set ARTICLE_TIPS_FIXTURES=1.'
)

const UNUSED = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

type FixtureLog = {
  prepared: Array<{ name: string; args: Record<string, unknown> }>
  submitted: Array<{ submissionId: string; txHash: string }>
  failed: Array<{ submissionId: string; reason: string; detail?: string }>
  signed: string[]
}

async function open(page: Page, query: string, mode: VarialMode = 'connected') {
  await page.addInitScript(installVarialEmulator, { mode, address: UNUSED })
  await page.goto(`/?${query}`)
  return page.getByRole('region', { name: /Tips/ })
}

async function chooseVarial(page: Page) {
  await page
    .getByRole('dialog', { name: 'Choose a wallet' })
    .getByRole('button', { name: /^Varial/ })
    .click()
}

const log = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __tipsFixture: FixtureLog }).__tipsFixture
  )

const wallet = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __fixtureWallet: { address: string } })
        .__fixtureWallet.address
  )

function signedCall(xdr: string) {
  const tx = TransactionBuilder.fromXDR(xdr, Networks.TESTNET) as Transaction
  // SDK 17 XDR values are plain objects with properties, not accessors.
  const op = tx.operations[0] as unknown as {
    type: string
    func: { invokeContract: { functionName: { toString(): string } } }
  }
  return {
    source: tx.source,
    timeBounds: tx.timeBounds,
    signatures: tx.signatures.length,
    type: op.type,
    method: op.func.invokeContract.functionName.toString(),
  }
}

test('renders nothing while payments v2 is off', async ({ page }) => {
  await open(page, 'state=hidden')
  await expect(page.getByRole('region', { name: /Tips/ })).toHaveCount(0)
})

test('asks for a receiving wallet first', async ({ page }) => {
  const panel = await open(page, 'state=no-wallet')
  await expect(
    panel.getByText(/Connect a receiving wallet first/)
  ).toBeVisible()
  await expect(
    panel.getByRole('link', { name: 'Set up your receiving wallet' })
  ).toHaveAttribute('href', '/dashboard/wallet')
  await expect(panel.getByRole('button')).toHaveCount(0)
})

test('asks to verify an unverified address first', async ({ page }) => {
  const panel = await open(page, 'state=unverified')
  await expect(panel.getByText(/Verify your receiving wallet/)).toBeVisible()
  await expect(
    panel.getByRole('link', { name: 'Verify your wallet' })
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Enable tips' })).toHaveCount(
    0
  )
})

test('enables tips: prepare, sign, send, pending, confirmed', async ({
  page,
}) => {
  const panel = await open(page, 'state=ready&confirmDelay=1500')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await chooseVarial(page)
  await expect(panel.getByRole('status')).toContainText(
    'Enabling tips. Waiting for Stellar testnet to confirm.'
  )
  await expect(
    panel.getByRole('link', { name: /View the transaction/ })
  ).toBeVisible()
  await expect(panel.getByText('Readers can tip this article.')).toBeVisible()
  // The panel's content was replaced: focus returns to its heading, and the
  // result is announced.
  await expect(panel.getByRole('heading', { name: /^Tips/ })).toBeFocused()
  await expect(panel.locator('[aria-live="polite"]')).toHaveText(
    'Tips enabled for this article.'
  )
  await expect(
    panel.getByRole('link', { name: /View the registration/ })
  ).toBeVisible()

  const { prepared, submitted, failed, signed } = await log(page)
  expect(prepared.map((p) => p.name)).toEqual([
    'chain.articles.prepareRegistration',
  ])
  expect(prepared[0]!.args).not.toHaveProperty('splits')
  expect(failed).toEqual([])
  expect(signed).toHaveLength(1)
  const call = signedCall(signed[0]!)
  expect(call).toMatchObject({
    source: await wallet(page),
    type: 'invokeHostFunction',
    method: 'register_article',
    signatures: 1,
  })
  expect(call.timeBounds?.minTime).toBe('0')
  expect(submitted).toHaveLength(1)
  const hash = Buffer.from(
    (
      TransactionBuilder.fromXDR(signed[0]!, Networks.TESTNET) as Transaction
    ).hash()
  ).toString('hex')
  expect(submitted[0]!.txHash).toBe(hash)
})

test('is usable from the keyboard alone', async ({ page }) => {
  const panel = await open(page, 'state=ready')
  await page.keyboard.press('Tab')
  await expect(
    panel.getByRole('checkbox', { name: 'Share tips with co-authors' })
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Enable tips' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('dialog', { name: 'Choose a wallet' })
  ).toBeVisible()
})

test('co-author shares are validated beside each field, then sent as basis points', async ({
  page,
}) => {
  const panel = await open(page, 'state=ready')
  await panel
    .getByRole('checkbox', { name: 'Share tips with co-authors' })
    .check()
  const shares = panel.getByRole('group', { name: /Shares of each tip/ })
  await expect(shares.getByText('You', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await expect(
    shares.getByText('Enter the co-author’s Stellar address.')
  ).toBeVisible()
  const address = shares.getByLabel('Co-author 1’s Stellar address')
  await expect(address).toHaveAttribute('aria-invalid', 'true')
  // Submitting moves focus to the first field that needs a fix.
  await expect(address).toBeFocused()
  // The error marks only the field that caused it.
  await expect(
    shares.getByLabel('Co-author 1’s share, percent')
  ).not.toHaveAttribute('aria-invalid', 'true')

  await address.fill('GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR')
  await expect(address).not.toHaveAttribute('aria-invalid', 'true')
  await shares.getByLabel('Co-author 1’s share, percent').fill('40')
  await expect(shares.getByText('Total 90%')).toBeVisible()
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await expect(panel.getByRole('alert')).toContainText(
    'Shares add up to 90%. They must add up to 100%.'
  )
  await shares.getByLabel('Your share, percent').fill('60')
  await expect(shares.getByText('Total 100%')).toBeVisible()
  await expect(panel.getByRole('alert')).toHaveCount(0)

  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await chooseVarial(page)
  await expect(panel.getByText('Readers can tip this article.')).toBeVisible()
  await expect(panel.getByText(/Author 60%, GCS5…DUAR 40%/)).toBeVisible()
  const { prepared } = await log(page)
  expect(prepared[0]!.args.splits).toEqual([
    { recipient: await wallet(page), bps: 6_000 },
    {
      recipient: 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR',
      bps: 4_000,
    },
  ])
})

test('allows at most four co-authors', async ({ page }) => {
  const panel = await open(page, 'state=ready')
  await panel
    .getByRole('checkbox', { name: 'Share tips with co-authors' })
    .check()
  for (let i = 0; i < 3; i++) {
    await panel.getByRole('button', { name: 'Add a co-author' }).click()
  }
  await expect(panel.getByText('Up to 4 co-authors.')).toBeVisible()
  await expect(
    panel.getByRole('button', { name: 'Add a co-author' })
  ).toHaveCount(0)
  await panel.getByRole('button', { name: 'Remove co-author 4' }).click()
  await expect(
    panel.getByRole('button', { name: 'Add a co-author' })
  ).toBeVisible()
})

test('a declined signature sends nothing and offers a retry', async ({
  page,
}) => {
  const panel = await open(page, 'state=ready', 'reject-sign')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await chooseVarial(page)
  const alert = panel.getByRole('alert')
  await expect(alert).toContainText('Request declined in your wallet')
  await expect(alert).toContainText('Nothing was signed or sent.')
  const { submitted, failed } = await log(page)
  expect(submitted).toEqual([])
  expect(failed).toMatchObject([
    { reason: 'wallet_rejected', detail: 'rejected' },
  ])
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeVisible()
  await alert.getByRole('button', { name: 'Dismiss' }).click()
  await expect(panel.getByRole('alert')).toHaveCount(0)
})

test('a wallet on another network is refused before signing', async ({
  page,
}) => {
  const panel = await open(page, 'state=ready', 'wrong-network')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await chooseVarial(page)
  await expect(
    page.getByText('Switch your wallet to Testnet').first()
  ).toBeVisible()
  expect((await log(page)).signed).toEqual([])
})

test('a prepare for another network is refused locally', async ({ page }) => {
  const panel = await open(page, 'state=ready&server=wrong-network')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await expect(panel.getByRole('alert')).toContainText(
    'The server prepared this for another network. Nothing was signed.'
  )
  const { signed, failed } = await log(page)
  expect(signed).toEqual([])
  expect(failed).toMatchObject([
    { reason: 'wallet_rejected', detail: 'client_check' },
  ])
})

test('no wallet extension says what to install', async ({ page }) => {
  const panel = await open(page, 'state=ready', 'missing')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await expect(panel.getByRole('alert')).toContainText(
    'No Stellar wallet found'
  )
})

test('an already registered article is reported from simulation', async ({
  page,
}) => {
  const panel = await open(page, 'state=ready&server=already-registered')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await chooseVarial(page)
  const alert = panel.getByRole('alert')
  await expect(alert).toContainText(
    'Tips are already on for this article. Refresh the page to see them.'
  )
  // Focus moves to the message, and no retry is offered: it would fail again.
  await expect(alert).toBeFocused()
  await expect(alert.getByRole('button', { name: /Try/ })).toHaveCount(0)
  const { signed, failed } = await log(page)
  expect(signed).toEqual([])
  expect(failed).toMatchObject([
    { reason: 'simulation_failed', detail: 'AlreadyRegistered' },
  ])
})

test('a send error is shown and recorded', async ({ page }) => {
  const panel = await open(page, 'state=ready&server=send-error')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await chooseVarial(page)
  await expect(panel.getByRole('alert')).toContainText(
    'Stellar testnet did not accept the transaction'
  )
  expect((await log(page)).failed).toMatchObject([{ reason: 'send_error' }])
})

test('a server refusal is explained', async ({ page }) => {
  const panel = await open(page, 'state=ready&server=prepare-error')
  await panel.getByRole('button', { name: 'Enable tips' }).click()
  await expect(panel.getByRole('alert')).toContainText(
    'Verify your receiving wallet first'
  )
})

test('a failed attempt can be retried', async ({ page }) => {
  const panel = await open(page, 'state=failed')
  await expect(
    panel.getByText(
      'The last attempt did not finish. Nothing changed on Stellar.'
    )
  ).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Enable tips' })).toBeEnabled()
})

test('a pending registration shows progress and the transaction', async ({
  page,
}) => {
  const panel = await open(page, 'state=pending')
  await expect(panel.getByRole('status')).toContainText('Enabling tips')
  await expect(
    panel.getByRole('link', { name: /View the transaction/ })
  ).toHaveAttribute('href', /stellar\.expert\/explorer\/testnet\/tx\//)
  await expect(panel.getByRole('button')).toHaveCount(0)
})

test('a transaction under review offers no retry', async ({ page }) => {
  const panel = await open(page, 'state=review')
  await expect(panel.getByText(/there is nothing to retry/)).toBeVisible()
  await expect(panel.getByRole('button')).toHaveCount(0)
})

test('a registered article shows its payout and shares', async ({ page }) => {
  const panel = await open(page, 'state=registered-splits')
  await expect(panel.getByText('Readers can tip this article.')).toBeVisible()
  await expect(panel.getByText('Version 1')).toBeVisible()
  await expect(panel.getByText(/Author 70%, GCS5…DUAR 30%/)).toBeVisible()
  await expect(panel.getByRole('button')).toHaveCount(0)
})

test('a changed article updates its anchor', async ({ page }) => {
  const panel = await open(page, 'state=outdated')
  await panel.getByRole('button', { name: 'Update the anchor' }).click()
  await chooseVarial(page)
  await expect(panel.getByText('Version 2')).toBeVisible()
  await expect(
    panel.getByRole('button', { name: 'Update the anchor' })
  ).toHaveCount(0)
  const { prepared, signed } = await log(page)
  expect(prepared[0]!.name).toBe('chain.articles.prepareContentUpdate')
  expect(signedCall(signed[0]!).method).toBe('update_content')
})

test('moving to a new wallet: the old wallet approves first', async ({
  page,
}) => {
  const panel = await open(page, 'state=move')
  await expect(
    panel.getByText(/Tips for this article still go to/)
  ).toBeVisible()
  const steps = panel.getByRole('listitem')
  await expect(steps.first()).toHaveAttribute('aria-current', 'step')
  await panel.getByRole('button', { name: /^Approve with / }).click()
  await chooseVarial(page)
  await expect(steps.nth(1)).toHaveAttribute('aria-current', 'step')
  await expect(panel.getByText('Done')).toBeVisible()
  await expect(
    panel.getByRole('button', { name: 'Approve with GBZX…MADI' })
  ).toBeVisible()
  const { prepared, signed } = await log(page)
  expect(prepared[0]!.name).toBe('chain.articles.prepareAuthorProposal')
  expect(prepared[0]!.args.currentLedger).toBe(1_234_567)
  expect(signedCall(signed[0]!)).toMatchObject({
    method: 'propose_author',
    source: await wallet(page),
  })
})

test('moving to a new wallet: the new wallet accepts', async ({ page }) => {
  const panel = await open(page, 'state=accept')
  await panel.getByRole('button', { name: /^Approve with / }).click()
  await chooseVarial(page)
  await expect(panel.getByText('Readers can tip this article.')).toBeVisible()
  await expect(
    panel.getByText(/Tips for this article still go to/)
  ).toHaveCount(0)
  expect(signedCall((await log(page)).signed[0]!).method).toBe('accept_author')
})

test('the wrong wallet account is caught before signing', async ({ page }) => {
  const panel = await open(page, 'state=move-wrong-wallet')
  await panel.getByRole('button', { name: /^Approve with / }).click()
  await chooseVarial(page)
  await expect(panel.getByRole('alert')).toContainText(
    'Switch your wallet to GBZX…MADI'
  )
  expect((await log(page)).signed).toEqual([])
})

test('the publish dialog variant shows the same action', async ({ page }) => {
  const panel = await open(page, 'state=ready&variant=dialog')
  await expect(panel.getByRole('button', { name: 'Enable tips' })).toBeVisible()
})

test('readers see why tips are off', async ({ page }) => {
  for (const [reason, text] of [
    ['unregistered', 'Tips aren’t on for this article yet.'],
    ['pending', 'Tips for this article turn on in a moment.'],
    [
      'payout_outdated',
      'Tips are paused while the writer updates their wallet.',
    ],
    ['paused', 'Tips are paused for a short time while payments are updated.'],
  ]) {
    await page.goto(`/?reader=${reason}`)
    await expect(page.getByRole('status')).toHaveText(text!)
  }
})

test('reduced motion stops the spinner', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const panel = await open(page, 'state=pending')
  const animation = await panel
    .locator('.tips-spinner')
    .first()
    .evaluate((el) => getComputedStyle(el).animationName)
  expect(animation).toBe('none')
})

for (const width of [375, 768, 1440]) {
  test(`fits at ${width}px without horizontal scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const panel = await open(page, 'state=ready')
    await panel
      .getByRole('checkbox', { name: 'Share tips with co-authors' })
      .check()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
    for (const target of await panel.getByRole('button').all()) {
      const box = await target.boundingBox()
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
  })
}
