import { test, expect, type Page } from '@playwright/test'
import {
  installVarialEmulator,
  type VarialMode,
} from './helpers/varialEmulator'

/**
 * Wallet connect and sign states through the real Wallets Kit 2.x, wallet
 * runtime and tip dialog, against an emulated Varial extension. The fixture
 * server stubs Convex and the Stellar client; nothing reaches a network.
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

async function openCheckout(page: Page) {
  await page.getByRole('button', { name: 'Tip article', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '1 test XLM' }).click()
  await dialog
    .getByRole('button', { name: 'Choose wallet', exact: true })
    .click()
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
  await dialog.getByRole('button', { name: 'Review in wallet' }).click()
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
})

test('no wallet: the install guide opens instead of the picker', async ({
  page,
}) => {
  await open(page, 'missing')
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  await expect(
    page.getByRole('dialog', { name: 'Make room for a little appreciation.' })
  ).toBeVisible()
  await expect(picker(page)).toHaveCount(0)
})

test('locked wallet', async ({ page }) => {
  await open(page, 'locked')
  await chooseVarial(page)
  await expect(page.getByText('Your wallet is locked')).toBeVisible()
  await expect(picker(page)).toBeHidden()
})

test('wrong network is refused before any signature', async ({ page }) => {
  await open(page, 'wrong-network')
  await chooseVarial(page)
  await expect(page.getByText('Switch your wallet to Testnet')).toBeVisible()
  await expect(
    page.getByText(/Your wallet is on Mainnet\. QuillTip uses Testnet/)
  ).toBeVisible()
  expect((await requests(page)).map((r) => r.type)).not.toContain(
    'SUBMIT_TRANSACTION'
  )
})

test('rejected signature', async ({ page }) => {
  await open(page, 'reject-sign')
  await chooseVarial(page)
  const dialog = await openCheckout(page)
  await dialog.getByRole('button', { name: 'Review in wallet' }).click()
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
  await dialog.getByRole('button', { name: 'Review in wallet' }).click()
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
