import { TransactionBuilder, type Transaction } from '@stellar/stellar-sdk'
import { test, expect, type Page } from './helpers/consoleGuard'
import {
  installVarialEmulator,
  type VarialMode,
} from './helpers/varialEmulator'
import { SEND_TIP } from './helpers/sendButton'

/**
 * Wallet connect and sign states through the real Wallets Kit 2.x, wallet
 * runtime and v2 article tip dialog, against an emulated Varial extension. The fixture
 * server stubs Convex and Stellar RPC; nothing reaches a network.
 *
 *   bun e2e/fixtures/wallet/server.mjs
 *   WALLET_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4177 bunx playwright test e2e/wallet-states.spec.ts
 */
test.skip(
  process.env.WALLET_FIXTURES !== '1',
  'Start e2e/fixtures/wallet/server.mjs and set WALLET_FIXTURES=1.'
)

const READER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const TESTNET = 'Test SDF Network ; September 2015'

async function open(page: Page, mode: VarialMode) {
  await page.addInitScript(installVarialEmulator, { mode, address: READER })
  await page.goto('/')
}

function picker(page: Page) {
  return page.getByRole('dialog', { name: 'Choose a wallet' })
}

async function chooseVarial(page: Page) {
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  await picker(page)
    .getByRole('button', { name: /^Varial/ })
    .click()
}

/** Opens the v2 article tip dialog with the default amount ($1, 10 XLM). */
async function openCheckout(page: Page) {
  await page.getByRole('button', { name: 'Tip article', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Tip this article' })
  await expect(
    dialog.getByRole('button', { name: '$1', exact: true })
  ).toHaveAttribute('aria-pressed', 'true')
  return dialog
}

async function requests(page: Page) {
  return page.evaluate(
    () =>
      (
        window as unknown as {
          __varialRequests: { type: string; networkPassphrase?: string }[]
        }
      ).__varialRequests
  )
}

test('connects through the kit picker and signs a testnet tip', async ({
  page,
}) => {
  await open(page, 'connected')
  await chooseVarial(page)
  const account = page.getByRole('button', { name: 'Open wallet menu' })
  await expect(account).toContainText('Varial')
  await expect(account).toContainText(/testnet/i)

  const dialog = await openCheckout(page)
  await dialog.getByRole('button', { name: SEND_TIP }).click()
  await expect
    .poll(async () =>
      (await requests(page)).find((r) => r.type === 'SUBMIT_TRANSACTION')
    )
    .toMatchObject({ networkPassphrase: TESTNET })
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __walletFixture: { signedXdr: string } })
            .__walletFixture.signedXdr
      )
    )
    .toBeTruthy()
  // One prepared tip, signed by the connected wallet: a Core contract call
  // from the wallet's address, for testnet.
  const { signedXdr, prepared, address } = await page.evaluate(() => {
    const w = window as unknown as {
      __walletFixture: { signedXdr: string; prepared: number }
      __fixtureWallet: { address: string }
    }
    return {
      signedXdr: w.__walletFixture.signedXdr,
      prepared: w.__walletFixture.prepared,
      address: w.__fixtureWallet.address,
    }
  })
  expect(prepared).toBe(1)
  const signed = TransactionBuilder.fromXDR(signedXdr, TESTNET) as Transaction
  expect(signed.source).toBe(address)
  expect(signed.signatures).toHaveLength(1)
  expect(signed.operations.map((op) => op.type)).toEqual(['invokeHostFunction'])
})

test('no extension: the picker opens with web wallets and install links', async ({
  page,
}) => {
  await open(page, 'missing')
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  const web = picker(page).getByRole('region', { name: 'No install needed' })
  await expect(web.getByRole('button', { name: /^xBull/ })).toBeVisible()
  await expect(
    picker(page)
      .getByRole('region', { name: 'Not installed' })
      .getByRole('link', { name: /^Varial/ })
  ).toHaveAttribute('href', 'https://varialwallet.com')
})

test('locked wallet', async ({ page }) => {
  await open(page, 'locked')
  await chooseVarial(page)
  await expect(page.getByText('Your wallet is locked')).toBeVisible()
  await expect(picker(page)).toBeHidden()
})

test('a locked wallet behind a password prompt is named while waiting and after (#547)', async ({
  page,
}) => {
  // The real extension, when locked, waits behind its password prompt and
  // tells the page nothing, so the app cannot show "locked" at once.
  await page.clock.install()
  await open(page, 'locked-prompt')
  await chooseVarial(page)
  await expect(
    picker(page).getByText(
      'Approve the request in Varial. If it asks for your password, unlock it first. If no window opened, check your browser toolbar.'
    )
  ).toBeVisible()
  await expect
    .poll(async () => (await requests(page)).map((r) => r.type))
    .toContain('REQUEST_ACCESS')
  await page.clock.fastForward(61_000)
  await expect(page.getByText('Your wallet did not respond')).toBeVisible()
  await expect(
    page.getByText(
      /Varial may be locked: unlock it, then try again\. If a wallet window is open, close it first\. Nothing was sent\./
    )
  ).toBeVisible()
})

test('wrong network is refused before any signature', async ({ page }) => {
  await open(page, 'wrong-network')
  await chooseVarial(page)
  await expect(page.getByText('Switch your wallet to Testnet')).toBeVisible()
  await expect(
    page.getByText(/Your wallet is on Mainnet\. Quilltip uses Testnet/)
  ).toBeVisible()
  expect((await requests(page)).map((r) => r.type)).not.toContain(
    'SUBMIT_TRANSACTION'
  )
})

test('rejected signature', async ({ page }) => {
  await open(page, 'reject-sign')
  await chooseVarial(page)
  const dialog = await openCheckout(page)
  await dialog.getByRole('button', { name: SEND_TIP }).click()
  await expect(
    dialog.getByText('Request declined in your wallet')
  ).toBeVisible()
  await expect(dialog.getByText(/Nothing was signed or sent/)).toBeVisible()
})

test('wallet that never answers times out', async ({ page }) => {
  await page.clock.install()
  await open(page, 'timeout-sign')
  await chooseVarial(page)
  const dialog = await openCheckout(page)
  await dialog.getByRole('button', { name: SEND_TIP }).click()
  await expect
    .poll(async () => (await requests(page)).map((r) => r.type))
    .toContain('SUBMIT_TRANSACTION')
  await page.clock.fastForward(121_000)
  await expect(dialog.getByText('Your wallet did not respond')).toBeVisible()
})

test('closing the picker is not an error and returns focus', async ({
  page,
}) => {
  await open(page, 'connected')
  const trigger = page.getByRole('button', { name: 'Connect Wallet' })
  await trigger.click()
  await expect(picker(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(picker(page)).toBeHidden()
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('the picker works from the keyboard alone', async ({ page }) => {
  await open(page, 'connected')
  await page.getByRole('button', { name: 'Connect Wallet' }).focus()
  await page.keyboard.press('Enter')
  const varial = picker(page).getByRole('button', { name: /^Varial/ })
  await expect(varial).toBeVisible()
  // Tab until the Varial option has focus, then choose it with Enter.
  for (
    let i = 0;
    i < 6 && !(await varial.evaluate((el) => el === document.activeElement));
    i++
  ) {
    await page.keyboard.press('Tab')
  }
  await expect(varial).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('button', { name: 'Open wallet menu' })
  ).toBeVisible()
})

test('fits a 375px screen without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await open(page, 'connected')
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  await expect(picker(page)).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  )
  expect(overflow).toBeLessThanOrEqual(0)
  const box = await picker(page)
    .getByRole('button', { name: /^Varial/ })
    .boundingBox()
  expect(box!.height).toBeGreaterThanOrEqual(44)
})
