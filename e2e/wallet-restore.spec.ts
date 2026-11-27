import { Keypair } from '@stellar/stellar-sdk'
import {
  test,
  expect,
  type BrowserContext,
  type Page,
} from './helpers/consoleGuard'
import {
  installVarialEmulator,
  type VarialMode,
} from './helpers/varialEmulator'

/**
 * Restoring the reader's last wallet after a page load (#562), through the
 * real wallet runtime and Wallets Kit against an emulated Varial extension
 * and a fake WalletConnect sign client. Nothing reaches a network.
 *
 * A reload keeps `localStorage` (the remembered wallet) and the tab's
 * `sessionStorage` (the emulator's mode, the fake sign client's sessions).
 *
 *   WALLET_FIXTURE_PORT=4377 bun e2e/fixtures/wallet/server.mjs
 *   WALLET_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4377 bunx playwright test e2e/wallet-restore.spec.ts
 */
test.skip(
  process.env.WALLET_FIXTURES !== '1',
  'Start e2e/fixtures/wallet/server.mjs and set WALLET_FIXTURES=1.'
)

// The fixture's signed-in reader is \`qa-reader\` (e2e/fixtures/wallet/runtime.ts).
const KEY = 'quilltip:wallet:v1:qa-reader'
const READER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const secret = Keypair.random().secret()
const address = Keypair.fromSecret(secret).publicKey()

type Request = { type: string }

const picker = (page: Page) =>
  page.getByRole('dialog', { name: 'Choose a wallet' })
const account = (page: Page) =>
  page.getByRole('button', { name: 'Open wallet menu' })
const connectButton = (page: Page) =>
  page.getByRole('button', { name: 'Connect Wallet', exact: true })

async function open(page: Page, url = `/?secret=${secret}`) {
  await page.addInitScript(installVarialEmulator, {
    mode: 'connected' as VarialMode,
    address: READER,
  })
  await page.goto(url)
}

async function connectVarial(page: Page) {
  await connectButton(page).click()
  await picker(page)
    .getByRole('button', { name: /^Varial/ })
    .click()
  await expect(account(page)).toContainText('Varial')
}

/** The extension's mode for the next load of this tab. */
async function setMode(page: Page, mode: VarialMode) {
  await page.evaluate(
    (next) => sessionStorage.setItem('qa-varial-mode', next),
    mode
  )
}

const requests = (page: Page) =>
  page.evaluate(() =>
    (
      (window as unknown as { __varialRequests?: Request[] })
        .__varialRequests ?? []
    ).map((request) => request.type)
  )

const remembered = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), KEY)

/** Waits until the restore on load has finished, either way. */
async function settled(page: Page) {
  await expect(
    page.getByRole('button', { name: 'Checking your wallet', exact: true })
  ).toHaveCount(0)
  await expect(account(page).or(connectButton(page))).toBeVisible()
}

const short = (key: string) => `${key.slice(0, 6)}...${key.slice(-6)}`
const lastUsed = (page: Page, name: string, key: string) =>
  page.getByText(`Last used: ${name}, ${short(key)}`)

/** Prompts and wallet windows the reader would see. */
const PROMPTS = ['REQUEST_ACCESS', 'SUBMIT_TRANSACTION', 'SUBMIT_BLOB']

test('restores the wallet after a reload when the site is still allowed, without a prompt', async ({
  page,
}) => {
  await open(page)
  await connectVarial(page)
  expect(JSON.parse((await remembered(page))!)).toEqual({
    walletId: 'varial',
    address,
  })

  await page.reload()
  await expect(account(page)).toContainText('Varial')
  await expect(account(page)).toContainText(
    `${address.slice(0, 6)}...${address.slice(-6)}`
  )
  await expect(picker(page)).toHaveCount(0)
  const seen = await requests(page)
  expect(seen).toContain('REQUEST_PUBLIC_KEY')
  expect(seen.filter((type) => PROMPTS.includes(type))).toEqual([])
})

test('access revoked: stays disconnected and asks nothing', async ({
  page,
}) => {
  await open(page)
  await connectVarial(page)
  await setMode(page, 'locked')
  await page.reload()
  await settled(page)
  await expect(connectButton(page)).toBeVisible()
  await expect(lastUsed(page, 'Varial', address)).toBeVisible()
  expect(
    (await requests(page)).filter((type) => PROMPTS.includes(type))
  ).toEqual([])
})

test('account changed since the last visit: stays disconnected with the remembered wallet as last used; connecting shows the new account as not the saved one', async ({
  page,
}) => {
  await open(page)
  await connectVarial(page)
  const next = Keypair.random()
  // The same wallet, now on another account; the saved address is READER.
  await page.goto(`/?secret=${next.secret()}&view=dashboard&link=other`)
  await settled(page)
  await expect(connectButton(page)).toBeVisible()
  await expect(lastUsed(page, 'Varial', address)).toBeVisible()
  const wallet = page.getByRole('region', { name: 'Your wallet' })
  await expect(wallet.getByText('Last used: Varial')).toBeVisible()
  await expect(wallet.getByText(address)).toBeVisible()
  expect(
    (await requests(page)).filter((type) => PROMPTS.includes(type))
  ).toEqual([])

  // The reader connects: the first prompt is one they started.
  await connectVarial(page)
  await expect(account(page)).toContainText(short(next.publicKey()))
  await expect(wallet.getByText(next.publicKey())).toBeVisible()
  await expect(
    wallet.getByText(
      `This is not your saved address. To tip, switch your wallet to ${READER.slice(0, 4)}…${READER.slice(-4)}.`
    )
  ).toBeVisible()
  expect(JSON.parse((await remembered(page))!)).toEqual({
    walletId: 'varial',
    address: next.publicKey(),
  })
})

test('wrong network: restored with the network shown, and refused before any signature', async ({
  page,
}) => {
  await open(page)
  await connectVarial(page)
  await setMode(page, 'wrong-network')
  await page.reload()
  await expect(account(page)).toContainText(/public/i)

  await page.getByRole('button', { name: 'Tip article', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '1 test XLM' }).click()
  await dialog
    .getByRole('button', { name: 'Choose wallet', exact: true })
    .click()
  // The dialog blocks the review: no signing request can be made.
  await expect(dialog.getByRole('alert')).toHaveText(
    'Switch your wallet to Stellar testnet to review this tip.'
  )
  await expect(
    dialog.getByRole('button', { name: 'Review in wallet' })
  ).toHaveCount(0)
  expect(
    (await requests(page)).filter((type) => PROMPTS.includes(type))
  ).toEqual([])
})

test('after Disconnect nothing reconnects on the next load', async ({
  page,
}) => {
  await open(page)
  await connectVarial(page)
  await account(page).click()
  await page.getByRole('menuitem', { name: 'Disconnect' }).click()
  await expect(connectButton(page)).toBeVisible()
  const storage = await page.evaluate(() => ({ ...localStorage }))
  expect(Object.keys(storage).filter((key) => /wallet/i.test(key))).toEqual([])

  await page.reload()
  await settled(page)
  await expect(connectButton(page)).toBeVisible()
  expect(await requests(page)).not.toContain('REQUEST_PUBLIC_KEY')
})

test('signing out forgets the wallet; the next reader to sign in does not get it back', async ({
  page,
}) => {
  await open(page)
  await connectVarial(page)
  await page.evaluate(() =>
    (
      window as unknown as { __fixtureAuth: { signOut(): void } }
    ).__fixtureAuth.signOut()
  )
  await expect(connectButton(page)).toBeVisible()
  expect(await remembered(page)).toBeNull()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('@StellarWalletsKit/selectedModuleId')
    )
  ).toBeNull()

  // Another reader signs in on this browser.
  await page.reload()
  await settled(page)
  await expect(connectButton(page)).toBeVisible()
  expect(await requests(page)).not.toContain('REQUEST_PUBLIC_KEY')
})

test('the sign-in page clears a wallet left by a reader whose session ended', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, value]) => {
      if (!sessionStorage.getItem('qa-seeded')) {
        localStorage.setItem(key, value)
        localStorage.setItem(
          '@StellarWalletsKit/activeAddress',
          JSON.parse(value).address
        )
        sessionStorage.setItem('qa-seeded', '1')
      }
    },
    [KEY, JSON.stringify({ walletId: 'varial', address })] as const
  )
  await page.goto('/?view=signin&auth=out')
  await expect(page.getByText('Sign-in page')).toBeVisible()
  await expect.poll(() => remembered(page)).toBeNull()
  expect(
    await page.evaluate(() =>
      localStorage.getItem('@StellarWalletsKit/activeAddress')
    )
  ).toBeNull()
})

test('a signed-out reader is not reconnected', async ({ page }) => {
  await page.addInitScript(([key, value]) => localStorage.setItem(key, value), [
    KEY,
    JSON.stringify({ walletId: 'varial', address }),
  ] as const)
  await open(page, `/?secret=${secret}&auth=out`)
  await settled(page)
  await expect(connectButton(page)).toBeVisible()
  await expect(page.getByText(/Last used/)).toHaveCount(0)
  expect(await requests(page)).not.toContain('REQUEST_PUBLIC_KEY')
})

for (const [walletId, name] of [
  ['xbull', 'xBull'],
  ['albedo', 'Albedo'],
  ['rabet', 'Rabet'],
  ['hana', 'Hana'],
] as const) {
  test(`${name} needs a prompt to answer: not restored, shown as last used, and no window opens`, async ({
    page,
  }) => {
    const popups: string[] = []
    page.on('popup', (popup) => popups.push(popup.url()))
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [KEY, JSON.stringify({ walletId, address })] as const
    )
    await open(page)
    await settled(page)
    await expect(connectButton(page)).toBeVisible()
    await expect(lastUsed(page, name, address)).toBeVisible()
    await page.waitForTimeout(500)
    expect(popups).toEqual([])
    // The choice is kept: it was the reader's, and asks nothing on load.
    expect(JSON.parse((await remembered(page))!)).toEqual({
      walletId,
      address,
    })
  })
}

const TAMPERED: [string, string, 'removed' | 'kept'][] = [
  ['not JSON', '{walletId:', 'removed'],
  [
    'an unknown wallet',
    JSON.stringify({ walletId: 'evil', address }),
    'removed',
  ],
  [
    'a wallet Quilltip does not offer',
    JSON.stringify({ walletId: 'lobstr', address }),
    'removed',
  ],
  [
    'an address that is not an account ID',
    JSON.stringify({ walletId: 'varial', address: 'G123' }),
    'removed',
  ],
  [
    'an extra field',
    JSON.stringify({ walletId: 'varial', address, session: 'secret' }),
    'removed',
  ],
  ['a list', JSON.stringify(['varial', address]), 'removed'],
]

for (const [name, value, outcome] of TAMPERED) {
  test(`tampered storage, ${name}: no wallet is selected or asked`, async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, stored]) => {
        if (sessionStorage.getItem('qa-seeded')) return
        localStorage.setItem(key, stored)
        sessionStorage.setItem('qa-seeded', '1')
      },
      [KEY, value] as const
    )
    await open(page)
    await settled(page)
    await expect(connectButton(page)).toBeVisible()
    expect(await requests(page)).not.toContain('REQUEST_PUBLIC_KEY')
    if (outcome === 'removed') expect(await remembered(page)).toBeNull()
  })
}

test('tampered storage, another account’s address: not restored, and the kit’s own key is not followed', async ({
  page,
}) => {
  await page.addInitScript(
    ([key, stored]) => {
      if (sessionStorage.getItem('qa-seeded')) return
      localStorage.setItem(key, stored)
      // The kit's own key names another wallet; it is not followed.
      localStorage.setItem('@StellarWalletsKit/selectedModuleId', 'albedo')
      sessionStorage.setItem('qa-seeded', '1')
    },
    [KEY, JSON.stringify({ walletId: 'varial', address: READER })] as const
  )
  const popups: string[] = []
  page.on('popup', (popup) => popups.push(popup.url()))
  await open(page)
  await settled(page)
  // The wallet reports its own account, not the stored one: no restore.
  await expect(connectButton(page)).toBeVisible()
  await expect(lastUsed(page, 'Varial', READER)).toBeVisible()
  expect(popups).toEqual([])
  expect(
    (await requests(page)).filter((type) => PROMPTS.includes(type))
  ).toEqual([])
})

async function openTab(context: BrowserContext) {
  const tab = await context.newPage()
  const errors: string[] = []
  tab.on('pageerror', (error) => errors.push(error.message))
  tab.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await open(tab)
  return { tab, errors }
}

test('two tabs: a Disconnect in one tab lets go of the wallet in the other', async ({
  page,
  context,
}) => {
  await open(page)
  await connectVarial(page)
  const { tab, errors } = await openTab(context)
  await expect(account(tab)).toContainText('Varial')

  await account(page).click()
  await page.getByRole('menuitem', { name: 'Disconnect' }).click()
  await expect(connectButton(tab)).toBeVisible()

  await tab.reload()
  await settled(tab)
  await expect(connectButton(tab)).toBeVisible()
  expect(errors).toEqual([])
})

test('two tabs: signing out in one tab lets go of the wallet in the other', async ({
  page,
  context,
}) => {
  await open(page)
  await connectVarial(page)
  const { tab, errors } = await openTab(context)
  await expect(account(tab)).toContainText('Varial')

  await page.evaluate(() =>
    (
      window as unknown as { __fixtureAuth: { signOut(): void } }
    ).__fixtureAuth.signOut()
  )
  await expect(connectButton(tab)).toBeVisible()
  expect(errors).toEqual([])
})

test('the restored state is not announced on load', async ({ page }) => {
  await open(page)
  await connectVarial(page)
  await page.reload()
  await expect(account(page)).toContainText('Varial')
  const live = await page
    .locator('[role="status"], [role="alert"], [aria-live]')
    .allTextContents()
  expect(live.join(' ')).not.toMatch(/connect|wallet/i)
})

test.describe('WalletConnect', () => {
  type FakeState = {
    pairings: number
    requests: unknown[]
    disconnects: string[]
  }
  const wcState = (page: Page) =>
    page.evaluate(
      () =>
        (window as unknown as { __wcFake: { state: FakeState } }).__wcFake.state
    )
  const approve = (page: Page) =>
    page.evaluate(() =>
      (
        window as unknown as { __wcFake: { approve(): void } }
      ).__wcFake.approve()
    )

  async function pair(page: Page) {
    await connectButton(page).click()
    await picker(page)
      .getByRole('button', { name: /^Mobile wallet/ })
      .click()
    await expect(
      picker(page).getByRole('heading', { name: 'Connect a mobile wallet' })
    ).toBeFocused()
    await approve(page)
    await expect(account(page)).toContainText('Mobile wallet')
  }

  test('not restored on load: the sign client is not loaded; the reader’s Connect reuses the live session without a code', async ({
    page,
  }) => {
    await page.goto(`/?wc=1&secret=${secret}`)
    await pair(page)
    await page.reload()
    await settled(page)
    await expect(connectButton(page)).toBeVisible()
    await expect(lastUsed(page, 'Mobile wallet', address)).toBeVisible()
    // The sign client module was never loaded on this page.
    expect(await page.evaluate(() => '__wcFake' in window)).toBe(false)

    await connectButton(page).click()
    await picker(page)
      .getByRole('button', { name: /^Mobile wallet/ })
      .click()
    await expect(account(page)).toContainText('Mobile wallet')
    const state = await wcState(page)
    expect(state.pairings).toBe(0)
    expect(state.requests).toEqual([])
  })

  test('a session left by a signed-out reader is closed, not reused', async ({
    page,
  }) => {
    await page.goto(`/?wc=1&secret=${secret}`)
    await pair(page)
    // Signed out on a page without the wallet: the session stays in the
    // sign client's storage, but the sign-in page forgets the choice.
    await page.goto(`/?wc=1&secret=${secret}&view=signin&auth=out`)
    await expect.poll(() => remembered(page)).toBeNull()
    await page.goto(`/?wc=1&secret=${secret}`)
    await settled(page)
    await expect(connectButton(page)).toBeVisible()
    await connectButton(page).click()
    await picker(page)
      .getByRole('button', { name: /^Mobile wallet/ })
      .click()
    await expect(
      picker(page).getByRole('heading', { name: 'Connect a mobile wallet' })
    ).toBeVisible()
    const state = await wcState(page)
    expect(state.pairings).toBe(1)
    expect(state.disconnects).toHaveLength(1)
  })
})
