import { readFile } from 'node:fs/promises'
import path from 'node:path'
import QR from 'qrcode'
import { test, expect, type Page } from './helpers/consoleGuard'

/**
 * WalletConnect (mobile wallets) through the real wallet runtime, Wallets
 * Kit, Quilltip's WalletConnect module, picker, tip dialog and address proof.
 * `?wc=1` serves the fixture built with a format-only project ID and a fake
 * sign client that plays the relay and the phone
 * (e2e/fixtures/wallet/fake-sign-client.ts). Nothing reaches a network.
 *
 *   bun e2e/fixtures/wallet/server.mjs
 *   WALLET_FIXTURES=1 QUILLTIP_E2E_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4177 bunx playwright test e2e/wallet-connect.spec.ts
 */
test.skip(
  process.env.WALLET_FIXTURES !== '1',
  'Start e2e/fixtures/wallet/server.mjs and set WALLET_FIXTURES=1.'
)

type FakeState = {
  inits: number
  pairings: number
  uri: string | null
  requests: { method: string; chainId: string }[]
  disconnects: string[]
  sessions: unknown[]
}

const picker = (page: Page) =>
  page.getByRole('dialog', { name: 'Choose a wallet' })
const account = (page: Page) =>
  page.getByRole('button', { name: 'Open wallet menu' })

const fake = {
  state: (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __wcFake: { state: FakeState } }).__wcFake.state
    ),
  call: (page: Page, method: string, arg?: unknown) =>
    page.evaluate(
      ([name, value]) =>
        (
          window as unknown as {
            __wcFake: Record<string, (arg?: unknown) => void>
          }
        ).__wcFake[name as string]!(value),
      [method, arg] as const
    ),
}

const signedXdr = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __walletFixture: { signedXdr: string | null } })
        .__walletFixture.signedXdr
  )

const DESKTOP_NOTE =
  'Scan a code with Varial, LOBSTR, Scopuly or another wallet'
const PHONE_NOTE = 'Opens Varial, LOBSTR, Scopuly or another wallet app'

async function choosePhone(page: Page, note = DESKTOP_NOTE) {
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  const phone = picker(page).getByRole('region', { name: 'On your phone' })
  await expect(
    phone.getByRole('button', { name: /^Mobile wallet/ })
  ).toContainText(note)
  await phone.getByRole('button', { name: /^Mobile wallet/ }).click()
  await expect(
    picker(page).getByRole('heading', { name: 'Connect a mobile wallet' })
  ).toBeFocused()
}

async function pairAndApprove(page: Page, opts?: unknown) {
  await choosePhone(page)
  await fake.call(page, 'approve', opts)
  await expect(account(page)).toContainText('Mobile wallet')
}

/** Sends the default tip ($1, 10 XLM) from the v2 article tip dialog. */
async function tip(page: Page) {
  await page.getByRole('button', { name: 'Tip article', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Tip this article' })
  await dialog.getByRole('button', { name: 'Send tip' }).click()
  return dialog
}

test('not listed without a project ID', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  await expect(
    picker(page).getByRole('heading', { name: 'Not installed' })
  ).toBeVisible()
  await expect(
    picker(page).getByRole('heading', { name: 'On your phone' })
  ).toHaveCount(0)
})

test('desktop: pairs by QR code, then signs a testnet tip on the phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/?wc=1')
  await choosePhone(page)
  const step = picker(page).getByRole('region', {
    name: 'Connect a mobile wallet',
  })
  await expect(
    step.getByRole('img', { name: /QR code that connects a phone wallet/ })
  ).toBeVisible()
  await expect(
    step.getByText('Open the wallet on your phone and scan this code.')
  ).toBeVisible()
  await expect(step.getByText(/The code expires in 5 minutes\./)).toBeVisible()
  await expect(
    step.getByRole('link', { name: 'Open in your wallet app' })
  ).toHaveCount(0)
  // Waiting for the reader to scan is not loading.
  await expect(picker(page)).toHaveAttribute('aria-busy', 'false')
  // No relay connection before the reader chose a mobile wallet; one now.
  expect((await fake.state(page)).inits).toBe(1)

  await fake.call(page, 'approve')
  await expect(account(page)).toContainText('Mobile wallet')
  await expect(account(page)).toContainText(/testnet/i)

  await tip(page)
  await expect.poll(() => signedXdr(page)).toBeTruthy()
  expect((await fake.state(page)).requests).toEqual([
    { method: 'stellar_signXDR', chainId: 'stellar:testnet' },
  ])
})

test('phone width: opens the wallet app by link; the code is one tap away', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/?wc=1')
  await choosePhone(page, PHONE_NOTE)
  const step = picker(page).getByRole('region', {
    name: 'Connect a mobile wallet',
  })
  const open = step.getByRole('link', { name: 'Open in your wallet app' })
  await expect(open).toHaveAttribute('href', /^wc:fixture1@2\?/)
  await expect(step.getByRole('img', { name: /QR code/ })).toBeHidden()
  await step.getByText('Show a code to scan with another device').click()
  await expect(step.getByRole('img', { name: /QR code/ })).toBeVisible()
  await fake.call(page, 'approve')
  await expect(account(page)).toContainText('Mobile wallet')
})

test('copies the pairing link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/?wc=1')
  await choosePhone(page)
  await picker(page).getByRole('button', { name: 'Copy link' }).click()
  await expect(picker(page).getByText('Link copied.')).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    (await fake.state(page)).uri
  )
})

test('back to wallets ends the pairing and keeps the picker open', async ({
  page,
}) => {
  await page.goto('/?wc=1')
  await choosePhone(page)
  await page.keyboard.press('Shift+Tab')
  await expect(
    picker(page).getByRole('button', { name: 'Back to wallets' })
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(
    picker(page).getByRole('heading', { name: 'On your phone' })
  ).toBeVisible()
  await expect(
    picker(page).getByRole('button', { name: /^Mobile wallet/ })
  ).toContainText('Connect')
  // Choosing again starts a new pairing.
  await picker(page)
    .getByRole('button', { name: /^Mobile wallet/ })
    .click()
  await expect.poll(async () => (await fake.state(page)).pairings).toBe(2)
})

test('closing the picker during a pairing ends it: a late approval does not connect', async ({
  page,
}) => {
  await page.goto('/?wc=1')
  await choosePhone(page)
  await page.keyboard.press('Escape')
  await expect(picker(page)).toBeHidden()
  // The phone approves after the reader closed the picker.
  await fake.call(page, 'approve')
  // A connection would show the account button within a few frames.
  await page.waitForTimeout(500)
  await expect(account(page)).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Connect Wallet' })
  ).toBeVisible()
})

test('the QR code encodes the pairing link', async ({ page }) => {
  await page.goto('/?wc=1')
  await choosePhone(page)
  const svg = picker(page).getByRole('img', { name: /QR code/ })
  await expect(svg).toBeVisible()
  const uri = (await fake.state(page)).uri!
  const expected = QR.create(uri, { errorCorrectionLevel: 'M' }).modules
  expect(Number(await svg.getAttribute('data-modules'))).toBe(expected.size)
  // Dark modules drawn, as "x,y" inside the four-module quiet zone.
  const d = (await svg.locator('path').getAttribute('d')) ?? ''
  const drawn = [...d.matchAll(/M(\d+) (\d+)/g)].map(
    ([, x, y]) => `${Number(x) - 4},${Number(y) - 4}`
  )
  const dark: string[] = []
  for (let i = 0; i < expected.size * expected.size; i++) {
    if (expected.data[i]) {
      dark.push(`${i % expected.size},${Math.floor(i / expected.size)}`)
    }
  }
  expect(drawn).toEqual(dark)
})

test('the minutes left count down to 1 minute', async ({ page }) => {
  await page.clock.install()
  await page.goto('/?wc=1')
  await choosePhone(page)
  const step = picker(page).getByRole('region', {
    name: 'Connect a mobile wallet',
  })
  await expect(step.getByText(/The code expires in 5 minutes\./)).toBeVisible()
  await page.clock.runFor('02:01')
  await expect(step.getByText(/The code expires in 3 minutes\./)).toBeVisible()
  await page.clock.runFor('02:00')
  await expect(step.getByText(/The code expires in 1 minute\./)).toBeVisible()
})

test('the phone declines the pairing', async ({ page }) => {
  await page.goto('/?wc=1')
  await choosePhone(page)
  await fake.call(page, 'decline')
  await expect(page.getByText('Request declined in your wallet')).toBeVisible()
  await expect(picker(page)).toBeHidden()
})

test('the pairing expires', async ({ page }) => {
  await page.goto('/?wc=1')
  await choosePhone(page)
  await fake.call(page, 'expire')
  await expect(page.getByText('Your wallet did not respond')).toBeVisible()
})

test('a phone wallet on mainnet only is refused and the session closed', async ({
  page,
}) => {
  await page.goto('/?wc=1')
  await choosePhone(page)
  await fake.call(page, 'approve', { chain: 'stellar:pubnet' })
  await expect(page.getByText('Switch your wallet to Testnet')).toBeVisible()
  expect((await fake.state(page)).disconnects).toHaveLength(1)
})

test('proves the address with a signed message', async ({ page }) => {
  await page.goto('/?wc=1&view=verify&link=unverified')
  const panel = page.getByRole('region', { name: 'Receiving wallet' })
  await panel.getByRole('button', { name: 'Connect wallet to verify' }).click()
  await picker(page)
    .getByRole('button', { name: /^Mobile wallet/ })
    .click()
  await fake.call(page, 'approve')
  await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
  const proofs = await page.evaluate(
    () =>
      (window as unknown as { __walletFixture: { proofs: string[] } })
        .__walletFixture.proofs
  )
  expect(proofs).toEqual(['message'])
})

test('a phone wallet without message signing proves with a transaction', async ({
  page,
}) => {
  await page.goto('/?wc=1&view=verify&link=unverified')
  const panel = page.getByRole('region', { name: 'Receiving wallet' })
  await panel.getByRole('button', { name: 'Connect wallet to verify' }).click()
  await picker(page)
    .getByRole('button', { name: /^Mobile wallet/ })
    .click()
  await fake.call(page, 'approve', { methods: ['stellar_signXDR'] })
  await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
  const proofs = await page.evaluate(
    () =>
      (window as unknown as { __walletFixture: { proofs: string[] } })
        .__walletFixture.proofs
  )
  expect(proofs).toEqual(['transaction'])
})

for (const [mode, title] of [
  ['reject', 'Request declined in your wallet'],
  ['mainnet', 'Switch your wallet to Testnet'],
  ['switch', 'Switch your wallet to Testnet'],
] as const) {
  test(`signing: the phone answers "${mode}"`, async ({ page }) => {
    await page.goto('/?wc=1')
    await pairAndApprove(page)
    await fake.call(page, 'setSignMode', mode)
    const dialog = await tip(page)
    await expect(dialog.getByText(title)).toBeVisible()
    expect(await signedXdr(page)).toBeNull()
  })
}

test('the phone ends the session: the app shows the wallet disconnected', async ({
  page,
}) => {
  await page.goto('/?wc=1')
  await pairAndApprove(page)
  await fake.call(page, 'endSession')
  await expect(account(page)).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: 'Connect Wallet' })
  ).toBeVisible()
})

test('disconnecting here ends the session on the phone', async ({ page }) => {
  await page.goto('/?wc=1')
  await pairAndApprove(page)
  await account(page).click()
  await page.getByRole('menuitem', { name: /Disconnect/ }).click()
  await expect(
    page.getByRole('button', { name: 'Connect Wallet' })
  ).toBeVisible()
  await expect
    .poll(async () => (await fake.state(page)).disconnects)
    .toHaveLength(1)
})

test('a live session is restored after a reload without a new code', async ({
  page,
}) => {
  await page.goto('/?wc=1')
  await pairAndApprove(page)
  await page.reload()
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  await picker(page)
    .getByRole('button', { name: /^Mobile wallet/ })
    .click()
  await expect(account(page)).toContainText('Mobile wallet')
  expect((await fake.state(page)).pairings).toBe(0)
})

test('pairing step: no axe violations', async ({ page }) => {
  await page.goto('/?wc=1')
  await choosePhone(page)
  await expect(picker(page).getByRole('img', { name: /QR code/ })).toBeVisible()
  await page.addScriptTag({
    content: await readFile(
      path.join(process.cwd(), 'node_modules/axe-core/axe.min.js'),
      'utf8'
    ),
  })
  const violations = await page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            context: unknown,
            options: unknown
          ) => Promise<{ violations: { id: string }[] }>
        }
      }
    ).axe
    const result = await axe.run(
      { include: ['[role="dialog"]'] },
      {
        runOnly: {
          type: 'tag',
          values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
        },
      }
    )
    return result.violations.map((v) => v.id)
  })
  expect(violations).toEqual([])
})
