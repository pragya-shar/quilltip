import { test, expect, type Page } from './helpers/consoleGuard'
import {
  installVarialEmulator,
  type VarialMode,
} from './helpers/varialEmulator'

/**
 * Proving control of a receiving address, through the real wallet runtime,
 * Wallets Kit and verification panel, against an emulated Varial extension
 * that signs with a throwaway testnet key. The fixture's Convex stand-ins run
 * the real challenge and proof checks (convex/lib/walletChallenge.ts).
 *
 *   bun e2e/fixtures/wallet/server.mjs
 *   WALLET_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4177 bunx playwright test e2e/wallet-verification.spec.ts
 */
test.skip(
  process.env.WALLET_FIXTURES !== '1',
  'Start e2e/fixtures/wallet/server.mjs and set WALLET_FIXTURES=1.'
)

const UNUSED = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'

async function open(page: Page, query: string, mode: VarialMode = 'connected') {
  await page.addInitScript(installVarialEmulator, { mode, address: UNUSED })
  await page.goto(`/?view=verify&${query}`)
  return page.getByRole('region', { name: 'Receiving wallet' })
}

async function openDashboard(page: Page, query: string) {
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as const,
    address: UNUSED,
  })
  await page.goto(`/?view=dashboard&${query}`)
}

async function chooseVarial(page: Page) {
  await page
    .getByRole('dialog', { name: 'Choose a wallet' })
    .getByRole('button', { name: /^Varial/ })
    .click()
}

const proofs = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __walletFixture: { proofs: string[] } })
        .__walletFixture.proofs
  )

test('an unverified address is verified with a signed message', async ({
  page,
}) => {
  const panel = await open(page, 'link=unverified')
  await expect(panel.getByText('Not verified')).toBeVisible()
  await expect(
    panel.getByText(/Verify this address to receive new tips/)
  ).toBeVisible()
  await panel.getByRole('button', { name: 'Connect wallet to verify' }).click()
  await chooseVarial(page)
  await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
  await expect(panel.getByRole('status')).toContainText(
    'Verified. Tips now go to'
  )
  await expect(panel.getByRole('button')).toHaveCount(0)
  expect(await proofs(page)).toEqual(['message'])
})

test('a wallet that cannot sign messages signs the never-submitted transaction', async ({
  page,
}) => {
  const panel = await open(page, 'link=none', 'no-message-signing')
  await expect(panel.getByText('No receiving address yet.')).toBeVisible()
  await panel.getByRole('button', { name: 'Connect wallet to verify' }).click()
  await chooseVarial(page)
  await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
  expect(await proofs(page)).toEqual(['transaction'])
})

test('declining in the wallet links nothing', async ({ page }) => {
  const panel = await open(page, 'link=unverified', 'reject-sign')
  await panel.getByRole('button', { name: 'Connect wallet to verify' }).click()
  await chooseVarial(page)
  await expect(panel.getByRole('alert')).toContainText(
    'Request declined in your wallet'
  )
  await expect(panel.getByText('Not verified')).toBeVisible()
  expect(await proofs(page)).toEqual([])
})

test('an address verified on another account is refused', async ({ page }) => {
  const panel = await open(page, 'link=unverified&server=address-in-use')
  await panel.getByRole('button', { name: 'Connect wallet to verify' }).click()
  await chooseVarial(page)
  await expect(panel.getByRole('alert')).toContainText(
    'This address is verified on another account'
  )
  await expect(panel.getByText('Not verified')).toBeVisible()
})

test('too many requests are explained', async ({ page }) => {
  const panel = await open(page, 'link=none&server=rate-limited')
  await panel.getByRole('button', { name: 'Connect wallet to verify' }).click()
  await chooseVarial(page)
  await expect(panel.getByRole('alert')).toContainText(
    'Too many verification requests'
  )
})

test('a verified address needs no action until another wallet connects', async ({
  page,
}) => {
  const panel = await open(page, 'link=verified')
  await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
  await expect(panel.getByRole('button')).toHaveCount(0)

  const other = await open(page, 'link=other')
  await page
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click()
  await chooseVarial(page)
  await expect(other.getByRole('button', { name: /^Verify G/ })).toBeVisible()
})

test('connecting the wallet that holds an unverified address re-verifies it', async ({
  page,
}) => {
  const panel = await open(page, 'link=unverified')
  // Connect from the header button, not the panel.
  await page
    .getByRole('button', { name: 'Connect Wallet', exact: true })
    .click()
  await chooseVarial(page)
  await expect(page.getByText('Verify your receiving address')).toBeVisible()
  await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
  expect(await proofs(page)).toEqual(['message'])
})

test('works from the keyboard alone', async ({ page }) => {
  const panel = await open(page, 'link=unverified')
  const action = panel.getByRole('button', { name: 'Connect wallet to verify' })
  await action.focus()
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
  await expect(varial).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
})

for (const width of [375, 768, 1440]) {
  test(`fits ${width}px without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const panel = await open(page, 'link=unverified')
    await expect(panel.getByText('Not verified')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
    const box = await panel
      .getByRole('button', { name: 'Connect wallet to verify' })
      .boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
  })
}

test('dashboard: verifying the address logs no errors and saves it once (#512)', async ({
  page,
}) => {
  await openDashboard(page, 'link=unverified')
  const dashboard = page.getByRole('region', { name: 'Dashboard wallet' })
  await expect(dashboard).toContainText('Your receiving address is saved.')
  await dashboard.getByText('Manage receiving address').click()
  await dashboard
    .getByRole('button', { name: /verify/i })
    .first()
    .click()
  await chooseVarial(page)
  await expect(
    dashboard.getByText('Verified', { exact: true }).first()
  ).toBeVisible()
  expect(await proofs(page)).toEqual(['message'])
  // The console guard fails this test on any "Maximum update depth" error.
  await page.waitForTimeout(500)
})

test('dashboard: a verified address loads with the wallet disconnected and no errors (#512)', async ({
  page,
}) => {
  await openDashboard(page, 'link=verified')
  const dashboard = page.getByRole('region', { name: 'Dashboard wallet' })
  await expect(dashboard).toContainText('Not connected')
  await expect(dashboard).toContainText(
    'Your receiving address is saved. You can receive tips while disconnected.'
  )
  await page.waitForTimeout(1500)
})
