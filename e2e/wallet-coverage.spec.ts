import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  test,
  expect,
  type BrowserContext,
  type Page,
} from './helpers/consoleGuard'
import { Keypair } from '@stellar/stellar-sdk'
import {
  installWalletEmulator,
  type EmulatedWallet,
  type EmulatorMode,
  type EmulatorOptions,
} from './helpers/walletEmulators'
import { installVarialEmulator } from './helpers/varialEmulator'

/**
 * Every wallet Quilltip offers (#511), through the real wallet runtime,
 * Wallets Kit modules, picker, tip dialog and address proof, against fake
 * providers shaped like each wallet's API (e2e/helpers/walletEmulators.ts).
 * xBull's web wallet runs in a real window served by a stand-in page
 * (e2e/fixtures/wallet/xbull-web.ts). Nothing reaches a network.
 *
 *   bun e2e/fixtures/wallet/server.mjs
 *   WALLET_FIXTURES=1 QUILLTIP_E2E_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4177 bunx playwright test e2e/wallet-coverage.spec.ts
 */
test.skip(
  process.env.WALLET_FIXTURES !== '1',
  'Start e2e/fixtures/wallet/server.mjs and set WALLET_FIXTURES=1.'
)

const TESTNET = 'Test SDF Network ; September 2015'
const HANA = { wallet: 'hana', mode: 'connected' } satisfies EmulatorOptions

type Requests = { method: string; network?: string }[]

const picker = (page: Page) =>
  page.getByRole('dialog', { name: 'Choose a wallet' })

const signedXdr = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __walletFixture: { signedXdr: string | null } })
        .__walletFixture.signedXdr
  )

const proofs = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __walletFixture: { proofs: string[] } })
        .__walletFixture.proofs
  )

const requests = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __walletRequests: Requests }).__walletRequests
  )

async function openCheckout(page: Page) {
  await page.getByRole('button', { name: 'Tip article', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '1 test XLM' }).click()
  await dialog
    .getByRole('button', { name: 'Choose wallet', exact: true })
    .click()
  return dialog
}

async function connectWith(page: Page, name: RegExp) {
  await page.getByRole('button', { name: 'Connect Wallet' }).click()
  await picker(page).getByRole('button', { name }).click()
}

type Case = {
  wallet: EmulatedWallet
  name: RegExp
  shown: string
  /** How the wallet proves the address: SEP-53 message, or a transaction. */
  proof: 'message' | 'transaction'
  /** The wallet reports its network, so a wrong one is refused at connect. */
  reportsNetwork: boolean
}

const CASES: Case[] = [
  {
    wallet: 'xbull',
    name: /^xBull/,
    shown: 'xBull',
    proof: 'message',
    reportsNetwork: false,
  },
  {
    wallet: 'rabet',
    name: /^Rabet/,
    shown: 'Rabet',
    proof: 'transaction',
    reportsNetwork: false,
  },
  {
    wallet: 'hana',
    name: /^Hana/,
    shown: 'Hana',
    proof: 'message',
    reportsNetwork: false,
  },
  {
    wallet: 'scopuly',
    name: /^Scopuly/,
    shown: 'Scopuly',
    proof: 'message',
    reportsNetwork: true,
  },
  {
    wallet: 'dcent',
    name: /^D'CENT/,
    shown: "D'CENT",
    proof: 'message',
    reportsNetwork: true,
  },
]

for (const c of CASES) {
  test.describe(c.shown, () => {
    async function open(page: Page, mode: EmulatorMode, query = '') {
      await page.addInitScript(installWalletEmulator, {
        wallet: c.wallet,
        mode,
      })
      await page.goto(`/${query}`)
    }

    test('is listed as installed, connects and signs a testnet tip', async ({
      page,
    }) => {
      await open(page, 'connected')
      await page.getByRole('button', { name: 'Connect Wallet' }).click()
      const installed = picker(page).getByRole('region', {
        name: 'In this browser',
      })
      await expect(
        installed.getByRole('button', { name: c.name })
      ).toBeVisible()
      await installed.getByRole('button', { name: c.name }).click()
      const account = page.getByRole('button', { name: 'Open wallet menu' })
      await expect(account).toContainText(c.shown)
      // Shown for wallets that cannot report a network too.
      await expect(account).toContainText(/testnet/i)

      const dialog = await openCheckout(page)
      await dialog.getByRole('button', { name: 'Review in wallet' }).click()
      await expect.poll(() => signedXdr(page)).toBeTruthy()
      const signing = (await requests(page)).find((r) => /sign/i.test(r.method))
      // Rabet takes a network name; the others take the passphrase.
      expect([TESTNET, 'testnet']).toContain(signing?.network)
    })

    test(`proves the address with a signed ${c.proof}`, async ({ page }) => {
      await open(page, 'connected', '?view=verify&link=unverified')
      const panel = page.getByRole('region', { name: 'Receiving wallet' })
      await panel
        .getByRole('button', { name: 'Connect wallet to verify' })
        .click()
      await picker(page).getByRole('button', { name: c.name }).click()
      await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
      expect(await proofs(page)).toEqual([c.proof])
    })

    test('locked', async ({ page }) => {
      await open(page, 'locked')
      await connectWith(page, c.name)
      await expect(page.getByText('Your wallet is locked')).toBeVisible()
      await expect(picker(page)).toBeHidden()
    })

    test('wrong network is refused and nothing is sent', async ({ page }) => {
      await open(page, 'wrong-network')
      await connectWith(page, c.name)
      if (c.reportsNetwork) {
        await expect(
          page.getByText('Switch your wallet to Testnet')
        ).toBeVisible()
        expect(
          (await requests(page)).filter((r) => /sign/i.test(r.method))
        ).toEqual([])
        return
      }
      // The wallet cannot say which network it is on: its signature is
      // checked against testnet instead.
      const dialog = await openCheckout(page)
      await dialog.getByRole('button', { name: 'Review in wallet' }).click()
      await expect(
        dialog.getByText('Switch your wallet to Testnet')
      ).toBeVisible()
      await expect(dialog.getByText(/Nothing was sent\./)).toBeVisible()
      expect(await signedXdr(page)).toBeNull()
    })

    test('refused signature', async ({ page }) => {
      await open(page, 'reject')
      await connectWith(page, c.name)
      const dialog = await openCheckout(page)
      await dialog.getByRole('button', { name: 'Review in wallet' }).click()
      await expect(
        dialog.getByText('Request declined in your wallet')
      ).toBeVisible()
      expect(await signedXdr(page)).toBeNull()
    })
  })
}

test.describe('xBull web wallet (no extension)', () => {
  const secret = Keypair.random().secret()
  let script = ''

  test.beforeAll(async () => {
    script = await (
      await fetch(
        `${process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:4177'}/fake/xbull-web.js`
      )
    ).text()
  })

  async function serveXbull(
    context: BrowserContext,
    mode: 'approve' | 'reject' | 'close' | 'wrong-network'
  ) {
    await context.route('https://wallet.xbull.app/**', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><title>xBull</title><body><script>window.__xbullWeb=${JSON.stringify(
          { secret, mode }
        )}</script><script>${script}</script></body>`,
      })
    )
  }

  async function chooseXbull(page: Page) {
    const web = picker(page).getByRole('region', { name: 'No install needed' })
    await expect(web.getByRole('button', { name: /^xBull/ })).toContainText(
      'Opens wallet.xbull.app in a new window'
    )
    await web.getByRole('button', { name: /^xBull/ }).click()
  }

  test('connects in its own window and signs a testnet tip', async ({
    page,
    context,
  }) => {
    await serveXbull(context, 'approve')
    await page.goto(`/?secret=${secret}`)
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    const popup = context.waitForEvent('page')
    await chooseXbull(page)
    expect((await popup).url()).toMatch(
      /^https:\/\/wallet\.xbull\.app\/connect/
    )
    await expect(
      page.getByRole('button', { name: 'Open wallet menu' })
    ).toContainText('xBull')
    await expect(
      page.getByRole('button', { name: 'Open wallet menu' })
    ).toContainText(/testnet/i)

    const dialog = await openCheckout(page)
    await dialog.getByRole('button', { name: 'Review in wallet' }).click()
    await expect.poll(() => signedXdr(page)).toBeTruthy()
  })

  test('proves the address with a signed message', async ({
    page,
    context,
  }) => {
    await serveXbull(context, 'approve')
    await page.goto(`/?view=verify&link=unverified&secret=${secret}`)
    const panel = page.getByRole('region', { name: 'Receiving wallet' })
    await panel
      .getByRole('button', { name: 'Connect wallet to verify' })
      .click()
    await chooseXbull(page)
    await expect(panel.getByText('Verified', { exact: true })).toBeVisible()
    expect(await proofs(page)).toEqual(['message'])
  })

  test('declined in the wallet', async ({ page, context }) => {
    await serveXbull(context, 'reject')
    await page.goto(`/?secret=${secret}`)
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    await chooseXbull(page)
    await expect(
      page.getByText('Request declined in your wallet')
    ).toBeVisible()
  })

  test('the reader closes the xBull window', async ({ page, context }) => {
    await serveXbull(context, 'close')
    await page.goto(`/?secret=${secret}`)
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    await chooseXbull(page)
    await expect(
      page.getByText('Request declined in your wallet')
    ).toBeVisible()
    await expect(
      page.getByText(/The xBull window was closed or the request was declined/)
    ).toBeVisible()
  })

  test('a blocked pop-up is reported at once', async ({ page, context }) => {
    await serveXbull(context, 'approve')
    await page.addInitScript(() => {
      window.open = () => null
    })
    await page.goto(`/?secret=${secret}`)
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    await chooseXbull(page)
    await expect(
      page.getByText('Your browser blocked the wallet window')
    ).toBeVisible({ timeout: 3000 })
  })

  test('a wallet on mainnet is refused after signing; nothing is sent', async ({
    page,
    context,
  }) => {
    await serveXbull(context, 'wrong-network')
    await page.goto(`/?secret=${secret}`)
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    await chooseXbull(page)
    const dialog = await openCheckout(page)
    await dialog.getByRole('button', { name: 'Review in wallet' }).click()
    await expect(
      dialog.getByText('Switch your wallet to Testnet')
    ).toBeVisible()
    expect(await signedXdr(page)).toBeNull()
  })
})

test.describe('Albedo', () => {
  test('opens albedo.link in a new window; closing it reads as declined', async ({
    page,
    context,
  }) => {
    await context.route('https://albedo.link/**', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<title>Albedo</title>' })
    )
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    const web = picker(page).getByRole('region', { name: 'No install needed' })
    const albedo = web.getByRole('button', { name: /^Albedo/ })
    await expect(albedo).toContainText('Opens albedo.link in a new window')
    const popup = context.waitForEvent('page')
    await albedo.click()
    const window = await popup
    expect(window.url()).toMatch(/^https:\/\/albedo\.link\//)
    await window.close()
    await expect(
      page.getByText('Request declined in your wallet')
    ).toBeVisible()
    await expect(
      page.getByText(/The Albedo window was closed or the request was declined/)
    ).toBeVisible()
  })
})

test.describe('picker', () => {
  test('without an extension: web wallets to use and extensions to install', async ({
    page,
  }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Connect Wallet' }).click()
    const dialog = picker(page)
    await expect(
      dialog.getByRole('heading', { name: 'No install needed' })
    ).toBeVisible()
    await expect(
      dialog.getByRole('heading', { name: 'In this browser' })
    ).toHaveCount(0)
    const web = dialog.getByRole('region', { name: 'No install needed' })
    await expect(web.getByRole('button')).toHaveText([/^xBull/, /^Albedo/])
    const install = dialog.getByRole('region', { name: 'Not installed' })
    for (const [name, href] of [
      ['Varial', 'https://varialwallet.com'],
      ['Rabet', 'https://rabet.io'],
      ['Hana', 'https://hanawallet.io'],
      ['Scopuly', 'https://extension.scopuly.com'],
      ["D'CENT", 'https://dcentwallet.com'],
    ] as const) {
      const link = install.getByRole('link', {
        name: new RegExp(`^${name}.*Get ${name} \\(opens in a new tab\\)$`),
      })
      await expect(link).toHaveAttribute('href', href)
      await expect(link).toHaveAttribute('target', '_blank')
    }
    await expect(
      install.getByText('Formerly Freighter. Browser extension')
    ).toBeVisible()
  })

  test('works with a keyboard and returns focus on Escape', async ({
    page,
  }) => {
    await page.addInitScript(installWalletEmulator, HANA)
    await page.goto('/')
    const trigger = page.getByRole('button', { name: 'Connect Wallet' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const hana = picker(page).getByRole('button', { name: /^Hana/ })
    await expect(hana).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker(page)).toBeHidden()
    await expect(trigger).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(hana).toBeVisible()
    for (
      let i = 0;
      i < 6 && !(await hana.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press('Tab')
    }
    await expect(hana).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('button', { name: 'Open wallet menu' })
    ).toContainText('Hana')
  })

  test('says which wallet to approve while it waits', async ({ page }) => {
    await page.addInitScript(installVarialEmulator, {
      mode: 'connected' as const,
      address: 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI',
    })
    // Hana never answers the address request, so the row stays waiting.
    await page.addInitScript(() => {
      ;(window as unknown as Record<string, unknown>).hanaWallet = {
        stellar: { getPublicKey: () => new Promise(() => {}) },
      }
    })
    await page.goto('/')
    await connectWith(page, /^Hana/)
    const dialog = picker(page)
    await expect(dialog.getByRole('button', { name: /^Hana/ })).toContainText(
      'Waiting'
    )
    await expect(dialog.getByRole('status').last()).toHaveText(
      'Approve the request in Hana. If it asks for your password, unlock it first. If no window opened, check your browser toolbar.'
    )
    await expect(
      dialog.getByRole('button', { name: /^Varial/ })
    ).toHaveAttribute('aria-disabled', 'true')
  })

  for (const view of ['picker', 'install'] as const) {
    test(`${view}: no axe violations`, async ({ page }) => {
      await page.addInitScript(installWalletEmulator, HANA)
      await page.goto(view === 'install' ? '/?view=install' : '/')
      if (view === 'picker') {
        await page.getByRole('button', { name: 'Connect Wallet' }).click()
        await expect(
          picker(page).getByRole('heading', { name: 'Not installed' })
        ).toBeVisible()
      } else {
        await expect(
          page.getByRole('dialog', {
            name: 'Make room for a little appreciation.',
          })
        ).toBeVisible()
      }
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
              ) => Promise<{
                violations: { id: string; nodes: { target: string[] }[] }[]
              }>
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
        return result.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target.join(' ')),
        }))
      })
      expect(violations).toEqual([])
    })
  }
})
