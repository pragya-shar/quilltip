import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  Account,
  Address,
  Keypair,
  MuxedAccount,
  Networks,
  StrKey,
  TransactionBuilder,
  scValToNative,
  type Transaction,
  type xdr,
} from '@stellar/stellar-sdk'
import {
  installVarialEmulator,
  type VarialMode,
} from './helpers/varialEmulator'
import { expectNoticeTookFocus } from './helpers/noticeFocus'

/**
 * The v2 article NFT (mint at the threshold and transfer) through the real
 * NFT panel, transfer dialog, flow state machine, action runner, call
 * encoder, wallet runtime and Wallets Kit, against an emulated Varial
 * extension that signs with a throwaway key. The fixture stands in for
 * Convex and Stellar RPC; nothing leaves the page.
 *
 *   bun e2e/fixtures/nft-v2/server.mjs
 *   NFT_V2_FIXTURES=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:4182 bunx playwright test e2e/nft-v2.spec.ts
 *
 * Set NFT_V2_SCREENSHOTS=<dir> to save every state at 375, 768 and 1440.
 */
test.skip(
  process.env.NFT_V2_FIXTURES !== '1',
  'Start e2e/fixtures/nft-v2/server.mjs and set NFT_V2_FIXTURES=1.'
)

const NFT = 'CCOJOXITZQM7R6FSFPICN4Y3GONM4TN4Y6QV64CARDHNNRUT3U5SCYT7'
const CORE = 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS'
const ADA = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
const OUTSIDE = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
const UNUSED = Keypair.random().publicKey()
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7))
const SHOTS = process.env.NFT_V2_SCREENSHOTS
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

type FixtureLog = {
  prepared: Array<{ name: string; args: Record<string, unknown> }>
  submitted: Array<{ submissionId: string; txHash: string }>
  failed: Array<{ submissionId: string; reason: string; detail?: string }>
  signed: string[]
  eligibilityReads: number
}

async function open(
  page: Page,
  query: string,
  mode: VarialMode = 'connected'
): Promise<string[]> {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(installVarialEmulator, { mode, address: UNUSED })
  await page.goto(`/?${query}`)
  await expect(
    page.getByRole('heading', { name: 'NFT Collection' })
  ).toBeVisible()
  return errors
}

const panel = (page: Page) => page.getByRole('region', { name: 'Article NFT' })

const log = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __nftFixture: FixtureLog }).__nftFixture
  )

const wallet = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as { __fixtureWallet: { address: string } })
        .__fixtureWallet.address
  )

async function chooseVarialIfAsked(page: Page) {
  const varial = page
    .getByRole('dialog', { name: 'Choose a wallet' })
    .getByRole('button', { name: /^Varial/ })
  try {
    await varial.waitFor({ state: 'visible', timeout: 5_000 })
  } catch {
    // Already connected, or the flow stopped before the wallet.
    return
  }
  await varial.click()
}

function invocation(signedXdr: string) {
  const tx = TransactionBuilder.fromXDR(
    signedXdr,
    Networks.TESTNET
  ) as Transaction
  // SDK 17 XDR values are plain objects with properties, not accessors.
  const invoke = (
    tx.operations[0] as unknown as {
      func: {
        invokeContract: {
          contractAddress: xdr.ScAddress
          functionName: { toString(): string }
          args: xdr.ScVal[]
        }
      }
    }
  ).func.invokeContract
  return {
    source: tx.source,
    contract: Address.fromScAddress(invoke.contractAddress).toString(),
    method: invoke.functionName.toString(),
    args: invoke.args.map((arg) => scValToNative(arg)),
    maxTime: Number(tx.timeBounds?.maxTime ?? 0),
  }
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  )
}

async function axe(page: Page) {
  // Scan the settled page: no picker closing, no result still rising in.
  await expect(
    page.getByRole('dialog', { name: 'Choose a wallet' })
  ).toHaveCount(0)
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (a) =>
          a.playState !== 'running' ||
          a.effect?.getTiming().iterations === Infinity
      )
  )
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze()
  return results.violations.map(
    (violation) =>
      `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`
  )
}

/** Every amount, token and transaction link carries the testnet label. */
async function expectTestnetLabelled(page: Page) {
  const scope = page.locator('.nft-v2, .nft-v2-dialog')
  const hasAmount = await scope
    .locator('.pay-xlm, .nft-v2-token, .pay-link[href*="stellar.expert"]')
    .count()
  if (hasAmount > 0) {
    await expect(scope.getByText('Stellar testnet').first()).toBeVisible()
  }
}

async function mint(page: Page) {
  await panel(page).getByRole('button', { name: 'Mint article NFT' }).click()
  await chooseVarialIfAsked(page)
}

async function openTransfer(page: Page) {
  await panel(page).getByRole('button', { name: 'Transfer NFT' }).click()
  const dialog = page.getByRole('dialog', { name: 'Transfer this NFT' })
  await expect(dialog).toBeVisible()
  return dialog
}

// ---------------------------------------------------------------------------
// Every state, at 375 and 1440 (and 768 for screenshots)
// ---------------------------------------------------------------------------

type Scene = {
  id: string
  query: string
  mode?: VarialMode
  /** Reaches the state from the loaded page. */
  act?: (page: Page) => Promise<void>
  /** Text that proves the state is showing. */
  expect: string | RegExp
  /**
   * Also run at 1440. Most states share one panel layout, so 375 carries
   * the checks; 1440 runs for the layouts that differ (all with screenshots).
   */
  wide?: true
}

const toReview = async (page: Page, recipient: string) => {
  const dialog = await openTransfer(page)
  await dialog.getByLabel('Recipient').fill(recipient)
  await dialog.getByRole('button', { name: 'Review transfer' }).click()
  await expect(
    dialog.getByRole('heading', { name: 'Check the recipient' })
  ).toBeVisible()
}

const typeRecipient =
  (value: string, blur = true) =>
  async (page: Page) => {
    const dialog = await openTransfer(page)
    const field = dialog.getByLabel('Recipient')
    await field.fill(value)
    if (blur) await field.blur()
  }

/** The section when this site has no v2 NFT. */
const NFT_OFFLINE = 'Article NFTs aren’t available on this site right now.'

const SCENES: Scene[] = [
  {
    // Payments v2 off: no NFT on this site.
    id: 'v2-disabled',
    query: 'state=v2-disabled',
    expect: NFT_OFFLINE,
    wide: true,
  },
  {
    // v2 on, no NFT contract: the same note, never a blank space.
    id: 'nft-unset',
    query: 'state=nft-unset',
    expect: NFT_OFFLINE,
  },
  {
    id: 'reader-below',
    query: 'state=reader-below',
    expect: /18\.75 XLM of 50 XLM tipped/,
    wide: true,
  },
  {
    id: 'reader-unknown-threshold',
    query: 'state=reader-unknown-threshold',
    expect: 'Article NFT',
  },
  {
    id: 'reader-reached',
    query: 'state=reader-reached',
    expect: 'This article has reached the mint threshold.',
    wide: true,
  },
  {
    id: 'reader-not-registered',
    query: 'state=reader-not-registered',
    expect: /Tips aren’t on for this article yet/,
  },
  {
    id: 'reader-v1-record',
    query: 'state=reader-v1-record',
    expect: 'v1 record',
  },
  {
    id: 'minted-outside',
    query: 'state=minted-outside',
    expect: 'A wallet outside Quilltip',
    wide: true,
  },
  { id: 'not-owner', query: 'state=not-owner', expect: '@writer' },
  {
    id: 'author-not-registered',
    query: 'state=author-not-registered',
    expect: 'Turn on tips for this article first.',
  },
  {
    id: 'author-checking',
    query: 'state=author-checking',
    expect: 'Checking the mint threshold…',
  },
  {
    id: 'author-below',
    query: 'state=author-below',
    expect: 'Minting unlocks at',
    wide: true,
  },
  {
    id: 'author-at-threshold',
    query: 'state=author-eligible',
    expect: 'Mint article NFT',
    wide: true,
  },
  {
    id: 'author-v1-record',
    query: 'state=author-v1-record',
    expect: 'v1 record',
  },
  {
    id: 'author-paused',
    query: 'state=author-paused',
    expect: 'Minting is paused',
    wide: true,
  },
  {
    id: 'author-no-wallet-link',
    query: 'state=author-no-wallet',
    expect: 'Link a wallet to mint',
  },
  {
    id: 'author-unverified',
    query: 'state=author-unverified',
    expect: 'Confirm this wallet is yours',
  },
  {
    id: 'author-other-wallet',
    query: 'state=author-other-wallet',
    expect: 'Use the wallet that receives this article’s tips',
  },
  {
    id: 'author-unavailable',
    query: 'state=author-unavailable',
    expect: 'Check again',
  },
  {
    id: 'author-rate-limited',
    query: 'state=author-rate-limited',
    expect: 'Too many checks in a row',
  },
  {
    id: 'author-pending',
    query: 'state=author-pending',
    expect: /Waiting for confirmation/,
  },
  { id: 'owner', query: 'state=owner', expect: 'Transfer NFT' },
  {
    id: 'owner-paused',
    query: 'state=owner-paused',
    expect: 'NFT transfers are paused',
    wide: true,
  },
  {
    id: 'former-owner',
    query: 'state=former-owner',
    expect: '@ada',
    wide: true,
  },
  {
    id: 'author-minted-indexing',
    query: 'state=author-minted-indexing',
    expect: /token and its owner show here in a moment/,
  },
  // Wallet states, reached by starting the mint.
  {
    id: 'wallet-locked',
    query: 'state=author-eligible',
    mode: 'locked',
    act: mint,
    expect: 'Your wallet is locked',
  },
  {
    id: 'wallet-wrong-network',
    query: 'state=author-eligible',
    mode: 'wrong-network',
    act: mint,
    expect: 'Switch your wallet to Testnet',
  },
  // Pending at each step.
  {
    id: 'mint-preparing',
    query: 'state=author-eligible&server=prepare-hold',
    act: mint,
    expect: 'Checking the details…',
  },
  {
    id: 'mint-simulating',
    query: 'state=author-eligible&server=simulate-hold',
    act: mint,
    expect: 'Checking the details…',
  },
  {
    id: 'mint-signing',
    query: 'state=author-eligible',
    mode: 'timeout-sign',
    act: mint,
    expect: /Approve the request in your wallet/,
  },
  {
    id: 'mint-sending',
    query: 'state=author-eligible&server=send-hold',
    act: mint,
    expect: 'Sending…',
  },
  {
    id: 'mint-checking',
    query: 'state=author-eligible&confirm=never',
    act: mint,
    expect: /Waiting for confirmation/,
  },
  {
    id: 'mint-slow',
    query: 'state=author-eligible&resume=mint:SUBMITTED&slow=1',
    expect: 'Still checking.',
  },
  {
    id: 'mint-resuming',
    query: 'state=author-eligible&resume=mint:PREPARED',
    expect: /Checking whether this payment went through/,
  },
  // Results.
  {
    id: 'mint-declined',
    query: 'state=author-eligible',
    mode: 'reject-sign',
    act: mint,
    expect: 'Request declined in your wallet',
  },
  {
    id: 'mint-send-error',
    query: 'state=author-eligible&server=send-error',
    act: mint,
    expect: 'Not sent',
  },
  {
    id: 'mint-paused-contract',
    query: 'state=author-eligible&server=paused',
    act: mint,
    expect: 'Minting is paused',
  },
  {
    id: 'mint-below-on-chain',
    query: 'state=author-eligible&server=below',
    act: mint,
    expect: /tip total needed to mint/,
  },
  {
    id: 'mint-expired',
    query: 'state=author-eligible&confirm=expired',
    act: mint,
    expect: 'This request timed out',
  },
  {
    id: 'mint-under-review',
    query: 'state=author-eligible&confirm=mismatch',
    act: mint,
    expect: 'Sent, but under review',
    wide: true,
  },
  {
    id: 'mint-confirmed-updating',
    query: 'state=author-eligible&confirm=unindexed',
    act: mint,
    expect: /owner shown here updates/,
  },
  {
    id: 'mint-confirmed',
    query: 'state=author-eligible',
    act: mint,
    expect: 'Article NFT minted',
    wide: true,
  },
  {
    id: 'mint-refused-already',
    query: 'state=author-eligible&server=prepare-error:ALREADY_MINTED',
    act: mint,
    expect: 'This article’s NFT is already minted',
  },
  // Transfer.
  {
    id: 'transfer-form',
    query: 'state=owner',
    act: async (page) => void (await openTransfer(page)),
    expect: 'Review transfer',
    wide: true,
  },
  {
    id: 'transfer-invalid-length',
    query: 'state=owner',
    act: typeRecipient(ADA.slice(0, 30)),
    expect: /A Stellar address has 56 characters/,
  },
  {
    id: 'transfer-invalid-checksum',
    query: 'state=owner',
    act: typeRecipient(ADA.slice(0, 55) + (ADA.endsWith('I') ? 'J' : 'I')),
    expect: /valid Stellar address/,
    wide: true,
  },
  {
    id: 'transfer-invalid-own',
    query: 'state=owner',
    act: async (page) => typeRecipient(await wallet(page))(page),
    expect: 'This NFT is already in that wallet.',
  },
  {
    id: 'transfer-invalid-platform',
    query: 'state=owner',
    act: typeRecipient(CORE),
    expect: /Quilltip contract/,
  },
  {
    id: 'transfer-invalid-muxed',
    query: 'state=owner',
    act: typeRecipient(
      new MuxedAccount(new Account(ADA, '0'), '9').accountId()
    ),
    expect: /Muxed addresses/,
  },
  {
    id: 'transfer-invalid-secret',
    query: 'state=owner',
    act: typeRecipient(Keypair.random().secret()),
    expect: /secret key/,
  },
  {
    id: 'transfer-invalid-format',
    query: 'state=owner',
    act: typeRecipient('ada lovelace!'),
    expect: /Enter a Stellar address/,
  },
  {
    id: 'transfer-user-not-found',
    query: 'state=owner',
    act: async (page) => {
      const d = await openTransfer(page)
      await d.getByLabel('Recipient').fill('@nobody')
      await d.getByRole('button', { name: 'Review transfer' }).click()
    },
    expect: /No Quilltip writer or reader has that username/,
  },
  {
    id: 'transfer-user-no-wallet',
    query: 'state=owner',
    act: async (page) => {
      const d = await openTransfer(page)
      await d.getByLabel('Recipient').fill('@nowallet')
      await d.getByRole('button', { name: 'Review transfer' }).click()
    },
    expect: /no confirmed wallet/,
  },
  {
    id: 'transfer-refused-paused',
    query: 'state=owner&server=prepare-error:PAUSED',
    act: async (page) => {
      const d = await openTransfer(page)
      await d.getByLabel('Recipient').fill('@ada')
      await d.getByRole('button', { name: 'Review transfer' }).click()
    },
    expect: 'NFT transfers are paused',
  },
  {
    id: 'transfer-review-user',
    query: 'state=owner',
    act: (page) => toReview(page, '@ada'),
    expect: 'Quilltip account @ada',
    wide: true,
  },
  {
    id: 'transfer-review-contract',
    query: 'state=owner',
    act: (page) => toReview(page, OTHER_CONTRACT),
    expect: /This is a contract address/,
    wide: true,
  },
  {
    id: 'transfer-pending',
    query: 'state=owner&confirm=never',
    act: async (page) => {
      await toReview(page, ADA)
      await page.getByRole('button', { name: 'Transfer NFT' }).last().click()
      await chooseVarialIfAsked(page)
    },
    expect: /Waiting for confirmation/,
  },
  {
    id: 'transfer-confirmed',
    query: 'state=owner',
    act: async (page) => {
      await toReview(page, ADA)
      await page.getByRole('button', { name: 'Transfer NFT' }).last().click()
      await chooseVarialIfAsked(page)
    },
    expect: 'NFT transferred',
    wide: true,
  },
  {
    id: 'transfer-resumed',
    query: 'state=owner&resume=transfer:SUBMITTED',
    expect: /Waiting for confirmation/,
  },
  {
    id: 'transfer-under-review',
    query: 'state=owner&resume=transfer:MISMATCH',
    expect: 'Sent, but under review',
  },
]

// 375 runs every state. 768 is for the screenshots only, and 1440 runs
// only the layouts that differ there, unless screenshots are being taken.
const WIDTHS = SHOTS ? ([375, 768, 1440] as const) : ([375, 1440] as const)

for (const width of WIDTHS) {
  const scenes =
    width === 375 || SHOTS ? SCENES : SCENES.filter((scene) => scene.wide)
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    for (const scene of scenes) {
      test(`${scene.id}`, async ({ page }) => {
        const errors = await open(page, scene.query, scene.mode)
        await scene.act?.(page)
        await expect(page.getByText(scene.expect).first()).toBeVisible({
          timeout: 10_000,
        })
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
        await expectTestnetLabelled(page)
        expect(await axe(page)).toEqual([])
        if (SHOTS) {
          await page.screenshot({
            path: path.join(SHOTS, `${scene.id}-${width}.png`),
            fullPage: true,
            animations: 'disabled',
          })
        }
        expect(errors).toEqual([])
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Behaviour
// ---------------------------------------------------------------------------

test.describe('mint', () => {
  test('mints from the prepared call and shows the owner only once indexed', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible&confirmDelay=800')
    const address = await wallet(page)
    await mint(page)
    await expect(
      page.getByRole('heading', { name: 'Article NFT minted' })
    ).toBeVisible()
    const l = await log(page)
    expect(l.prepared.map((p) => p.name)).toEqual(['nftsV2.prepareMint'])
    expect(typeof l.prepared[0]!.args.requestId).toBe('string')
    expect(l.signed).toHaveLength(1)
    const call = invocation(l.signed[0]!)
    expect(call.source).toBe(address)
    expect(call.method).toBe('mint')
    expect(Buffer.from(call.args[0] as Uint8Array).toString('hex')).toBe(
      'c4'.repeat(32)
    )
    expect(l.submitted).toHaveLength(1)
    // The minted view comes from the indexed row.
    await expect(panel(page).getByText('#7')).toBeVisible()
    await expect(panel(page).getByText('You', { exact: true })).toBeVisible()
    await expect(
      panel(page)
        .getByRole('link', { name: /View the transaction/ })
        .first()
    ).toHaveAttribute('href', /stellar\.expert\/explorer\/testnet\/tx\//)
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(
      page.getByRole('heading', { name: 'Article NFT minted' })
    ).toHaveCount(0)
    await expect(
      panel(page).getByRole('button', { name: 'Transfer NFT' })
    ).toBeVisible()
  })

  test('a wallet refusal is recorded and Try again starts a new request', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible', 'reject-sign')
    await mint(page)
    await expect(
      page.getByRole('heading', { name: 'Request declined in your wallet' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    const l = await log(page)
    expect(l.failed).toEqual([
      { submissionId: 'sub-1', reason: 'wallet_rejected', detail: 'rejected' },
    ])
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(async () => (await log(page)).prepared.length).toBe(2)
    const [first, second] = (await log(page)).prepared
    expect(first!.args.requestId).not.toBe(second!.args.requestId)
  })

  test('no retry after a mismatch', async ({ page }) => {
    await open(page, 'state=author-eligible&confirm=mismatch')
    await mint(page)
    await expect(
      page.getByRole('heading', { name: 'Sent, but under review' })
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0)
    await expect(page.getByText(/Reference: sub-1/)).toBeVisible()
  })

  test('a reload in the middle resumes from the server record', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible&confirm=never')
    await mint(page)
    const checking = page.locator('.pay-progress-sentence', {
      hasText: 'Waiting for confirmation',
    })
    await expect(checking).toBeVisible()
    await page.reload()
    await expect(checking).toBeVisible()
    // Nothing new was prepared or signed after the reload.
    const l = await log(page)
    expect(l.prepared).toHaveLength(0)
    expect(l.signed).toHaveLength(0)
    await expect(
      panel(page).getByRole('button', { name: 'Mint article NFT' })
    ).toHaveCount(0)
  })

  test('a prepared call for another network is refused before signing', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible&server=wrong-network')
    await mint(page)
    await expect(
      page.getByRole('heading', {
        name: 'This request doesn’t match what you confirmed',
      })
    ).toBeVisible()
    const l = await log(page)
    expect(l.signed).toHaveLength(0)
    expect(l.failed[0]).toMatchObject({
      reason: 'wallet_rejected',
      detail: 'client_check',
    })
  })

  test('no wallet extension: the picker offers web wallets, and closing it is not an error', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible', 'missing')
    await panel(page).getByRole('button', { name: 'Mint article NFT' }).click()
    const picker = page.getByRole('dialog', { name: 'Choose a wallet' })
    await expect(
      picker
        .getByRole('region', { name: 'No install needed' })
        .getByRole('button', { name: /^xBull/ })
    ).toBeVisible()
    await expect(
      picker
        .getByRole('region', { name: 'Not installed' })
        .getByRole('link', { name: /^Varial/ })
    ).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    // Back to the mint action, with no error.
    await expect(
      panel(page).getByRole('button', { name: 'Mint article NFT' })
    ).toBeVisible()
    await expect(panel(page).getByRole('alert')).toHaveCount(0)
    expect((await log(page)).signed).toEqual([])
  })

  test('readers cause no live eligibility read', async ({ page }) => {
    await open(page, 'state=reader-below')
    await expect(
      panel(page).getByText('18.75 XLM of 50 XLM tipped')
    ).toBeVisible()
    expect((await log(page)).eligibilityReads).toBe(0)
    await expect(panel(page).getByRole('button')).toHaveCount(0)
    await expect(
      panel(page).getByText('Tab tips don’t count.', { exact: false })
    ).toBeVisible()
  })
})

test.describe('transfer', () => {
  test('validates as the user types: late for an unfinished address, at once for a wrong one', async ({
    page,
  }) => {
    await open(page, 'state=owner')
    const dialog = await openTransfer(page)
    const field = dialog.getByLabel('Recipient')
    await expect(field).toBeFocused()
    await field.pressSequentially(ADA.slice(0, 12))
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await field.blur()
    await expect(dialog.getByRole('alert')).toContainText('56 characters')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    // Once shown, the error follows each edit and clears when fixed.
    await field.fill(ADA)
    await expect(dialog.getByRole('alert')).toHaveCount(0)
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await field.fill(NFT)
    await expect(dialog.getByRole('alert')).toContainText('Quilltip contract')
    expect((await log(page)).prepared).toHaveLength(0)
  })

  test('confirms the full address, signs it, and moves ownership once indexed', async ({
    page,
  }) => {
    await open(page, 'state=owner')
    const owner = await wallet(page)
    await toReview(page, ADA.toLowerCase())
    const dialog = page.getByRole('dialog', { name: 'Transfer this NFT' })
    await expect(dialog.getByTestId('recipient-address')).toHaveText(
      ADA.match(/.{1,4}/g)!.join('')
    )
    await expect(dialog.getByTestId('irreversible')).toContainText(
      'can’t be undone'
    )
    await dialog.getByRole('button', { name: 'Transfer NFT' }).click()
    await chooseVarialIfAsked(page)
    await expect(
      dialog.getByRole('heading', { name: 'NFT transferred' })
    ).toBeVisible()
    const call = invocation((await log(page)).signed[0]!)
    expect(call.method).toBe('transfer')
    expect(call.args).toEqual([owner, ADA, 7])
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toHaveCount(0)
    // The former owner loses the action; the new owner shows.
    await expect(panel(page).getByText('@ada')).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: 'Transfer NFT' })
    ).toHaveCount(0)
  })

  test('refuses a prepared recipient other than the one confirmed', async ({
    page,
  }) => {
    await open(page, 'state=owner&server=swap')
    await toReview(page, ADA)
    const dialog = page.getByRole('dialog', { name: 'Transfer this NFT' })
    await dialog.getByRole('button', { name: 'Transfer NFT' }).click()
    await expect(
      dialog.getByRole('heading', {
        name: 'This request doesn’t match what you confirmed',
      })
    ).toBeVisible()
    expect((await log(page)).signed).toHaveLength(0)
  })

  test('cancelling the review frees the request on the server', async ({
    page,
  }) => {
    await open(page, 'state=owner')
    await toReview(page, '@ada')
    await page.getByRole('button', { name: 'Change recipient' }).click()
    await expect(page.getByLabel('Recipient')).toBeVisible()
    expect((await log(page)).failed).toEqual([
      { submissionId: 'sub-1', reason: 'wallet_rejected', detail: 'cancelled' },
    ])
  })

  test('a review that timed out is prepared again and shown again', async ({
    page,
  }) => {
    await open(page, 'state=owner&reviewSeconds=10')
    await toReview(page, ADA)
    await page.getByRole('button', { name: 'Transfer NFT' }).last().click()
    await expect(page.getByText('Check the address again')).toBeVisible()
    const l = await log(page)
    expect(l.prepared).toHaveLength(2)
    expect(l.signed).toHaveLength(0)
  })

  test('an outside transfer shows the new owner and removes the action', async ({
    page,
  }) => {
    await open(page, 'state=owner')
    await expect(
      panel(page).getByRole('button', { name: 'Transfer NFT' })
    ).toBeVisible()
    await page.evaluate((to) => {
      ;(
        window as unknown as {
          __nftFixtureControl: { moveOwner: (to: string) => void }
        }
      ).__nftFixtureControl.moveOwner(to)
    }, OUTSIDE)
    await expect(
      panel(page).getByText('A wallet outside Quilltip')
    ).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: 'Transfer NFT' })
    ).toHaveCount(0)
  })

  test('shows the secret-key warning as the key is typed, before blur', async ({
    page,
  }) => {
    await open(page, 'state=owner')
    const dialog = await openTransfer(page)
    const field = dialog.getByLabel('Recipient')
    await field.fill(Keypair.random().secret())
    await expect(field).toBeFocused()
    await expect(dialog.getByRole('alert')).toContainText('secret key')
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    expect((await log(page)).prepared).toHaveLength(0)
  })

  test('a username that is the owner’s own account shows the refusal on the field', async ({
    page,
  }) => {
    await open(page, 'state=owner')
    const dialog = await openTransfer(page)
    const field = dialog.getByLabel('Recipient')
    await field.fill('@writer')
    await dialog.getByRole('button', { name: 'Review transfer' }).click()
    await expect(dialog.getByRole('alert')).toContainText(
      'This NFT is already in that wallet'
    )
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toBeFocused()
    await expect(
      dialog.getByRole('heading', { name: 'Check the recipient' })
    ).toHaveCount(0)
  })

  test('offers no transfer while the NFT contract is paused', async ({
    page,
  }) => {
    await open(page, 'state=owner-paused')
    await expect(
      panel(page).getByText('NFT transfers are paused')
    ).toBeVisible()
    await expect(panel(page).getByText('Payments are paused')).toHaveCount(0)
    await expect(
      panel(page).getByRole('button', { name: 'Transfer NFT' })
    ).toHaveCount(0)
  })

  test('the former owner sees the new owner and no action', async ({
    page,
  }) => {
    await open(page, 'state=former-owner')
    await expect(panel(page).getByText('@ada')).toBeVisible()
    await expect(panel(page).getByText('You', { exact: true })).toHaveCount(0)
    await expect(panel(page).getByRole('button')).toHaveCount(0)
  })

  test('works with the keyboard alone, with focus where it belongs', async ({
    page,
    browserName,
  }) => {
    // Safari's Tab skips buttons with default settings; Option+Tab reaches
    // them.
    const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab'
    await open(page, 'state=owner')
    const trigger = panel(page).getByRole('button', { name: 'Transfer NFT' })
    await trigger.focus()
    await page.keyboard.press('Enter')
    const dialog = page.getByRole('dialog', { name: 'Transfer this NFT' })
    await expect(dialog.getByLabel('Recipient')).toBeFocused()
    await page.keyboard.type('@ada')
    await page.keyboard.press('Enter')
    await expect(
      dialog.getByRole('heading', { name: 'Check the recipient' })
    ).toBeFocused()
    // Tab reaches Copy, Change recipient, then Transfer NFT.
    await page.keyboard.press(next)
    await expect(
      dialog.getByRole('button', { name: 'Copy address' })
    ).toBeFocused()
    await page.keyboard.press(next)
    await page.keyboard.press(next)
    await expect(
      dialog.getByRole('button', { name: 'Transfer NFT' })
    ).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
})

test.describe('refusal focus', () => {
  for (const how of ['click', 'Enter'] as const) {
    test(`a refused mint takes focus on the refusal title (${how})`, async ({
      page,
    }) => {
      await open(
        page,
        'state=author-eligible&server=prepare-error:ALREADY_MINTED'
      )
      const button = panel(page).getByRole('button', {
        name: 'Mint article NFT',
      })
      await expect(button).toBeVisible()
      if (how === 'click') await button.click()
      else {
        await button.focus()
        await page.keyboard.press('Enter')
      }
      await chooseVarialIfAsked(page)
      await expectNoticeTookFocus(
        page,
        panel(page),
        'This article’s NFT is already minted'
      )
    })
  }
})

test.describe('on a touch screen', () => {
  test.use({
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  })

  test('the dialog takes focus without opening the keyboard', async ({
    page,
  }) => {
    await open(page, 'state=owner')
    expect(
      await page.evaluate(() => matchMedia('(pointer: coarse)').matches)
    ).toBe(true)
    await panel(page).getByRole('button', { name: 'Transfer NFT' }).tap()
    const dialog = page.getByRole('dialog', { name: 'Transfer this NFT' })
    await expect(
      dialog.getByRole('heading', { name: 'Transfer this NFT' })
    ).toBeFocused()
    await expect(dialog.getByLabel('Recipient')).not.toBeFocused()
  })
})

test.describe('motion and live regions', () => {
  test('respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await open(page, 'state=reader-below')
    const transition = await page
      .locator('.nft-progress-fill')
      .evaluate((el) => getComputedStyle(el).transitionDuration)
    expect(transition).toBe('0s')
  })

  test('announces progress politely and refusals assertively', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible', 'reject-sign')
    // Live regions are mounted empty on load.
    await mint(page)
    await expect(page.locator('.pay-progress [role="alert"]')).toContainText(
      'Request declined in your wallet'
    )
  })
})

test.describe('reflow at 320px (400% zoom of 1280)', () => {
  test.use({ viewport: { width: 320, height: 640 } })
  for (const id of [
    'author-below',
    'owner',
    'transfer-review-user',
    'transfer-invalid-length',
    'mint-under-review',
  ]) {
    test(id, async ({ page }) => {
      const scene = SCENES.find((s) => s.id === id)!
      await open(page, scene.query, scene.mode)
      await scene.act?.(page)
      await expect(page.getByText(scene.expect).first()).toBeVisible({
        timeout: 10_000,
      })
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
      // Text spacing overrides (WCAG 1.4.12) must not clip content either.
      await page.addStyleTag({
        content:
          '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }',
      })
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
    })
  }
})

test.describe('worst-case data', () => {
  for (const width of [320, 1440]) {
    test.describe(`at ${width}px`, () => {
      test.use({ viewport: { width, height: 800 } })
      const cases: Scene[] = [
        {
          id: 'worst-author-huge-total',
          query: 'state=author-eligible&data=worst',
          expect: /1,234,567,890\.1234567 XLM/,
        },
        {
          id: 'worst-reader-one-stroop-short',
          query: 'state=reader-below&data=worst',
          expect: /49\.9999999 XLM of 50 XLM tipped/,
        },
        {
          id: 'worst-reader-nothing-tipped',
          query: 'state=reader-below&data=empty',
          expect: /0 XLM of 50 XLM tipped/,
        },
        {
          id: 'worst-not-owner-long-name',
          query: 'state=not-owner&data=worst',
          expect: '@bartholomew_fitzgera',
        },
        {
          id: 'worst-owner-max-token',
          query: 'state=owner&data=worst',
          expect: '#4294967295',
        },
        {
          id: 'worst-review-long-user',
          query: 'state=owner&data=worst',
          act: (page) => toReview(page, '@bartholomew_fitzgera'),
          expect: 'Quilltip account @bartholomew_fitzgera',
        },
      ]
      for (const scene of cases) {
        test(scene.id, async ({ page }) => {
          const errors = await open(page, scene.query, scene.mode)
          await scene.act?.(page)
          await expect(page.getByText(scene.expect).first()).toBeVisible()
          expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0)
          // Nothing inside the panel or dialog spills out of its box.
          const spill = await page.evaluate(() =>
            [...document.querySelectorAll('.nft-v2 *, .nft-v2-dialog *')]
              .filter(
                (el) =>
                  el.scrollWidth > el.clientWidth + 1 &&
                  getComputedStyle(el).overflowX === 'visible' &&
                  el.clientWidth > 0
              )
              .map((el) => `${el.tagName.toLowerCase()}.${el.className}`)
          )
          expect(spill).toEqual([])
          if (SHOTS) {
            await page.screenshot({
              path: path.join(SHOTS, `${scene.id}-${width}.png`),
              fullPage: true,
              animations: 'disabled',
            })
          }
          expect(errors).toEqual([])
        })
      }
    })
  }
})

// --- Follow-ups from the testnet wallet run (#547) -------------------------

test.describe('testnet wallet run follow-ups (#547)', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a wallet on another account is asked to switch to the linked address; nothing was signed', async ({
    page,
  }) => {
    const errors = await open(page, 'state=author-eligible&wallet=other')
    await mint(page)
    await expect(
      panel(page).getByText(
        /^Switch your wallet to G[A-Z0-9]{3,5}…[A-Z0-9]{4}$/
      )
    ).toBeVisible()
    await expect(
      panel(page)
        .getByText(
          /Minting is signed by .+, the address linked to your Quilltip account\. Your wallet is on .+\. Switch accounts in your wallet, then try again\. Nothing was signed\./
        )
        .first()
    ).toBeVisible()
    await expect(
      panel(page).getByText(/signed with another account/)
    ).toHaveCount(0)
    expect((await log(page)).signed).toEqual([])
    expect((await log(page)).failed).toEqual([
      expect.objectContaining({
        reason: 'wallet_rejected',
        detail: 'wrong_account',
      }),
    ])
    expect(errors).toEqual([])
  })

  test('after a confirmed mint and Done, the panel waits for the owner instead of offering Mint', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible&confirm=lagging')
    await mint(page)
    await expect(
      page.getByRole('heading', { name: 'Article NFT minted' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Done' }).click()
    await expect(
      panel(page).getByText(
        'Stellar testnet confirmed the mint. The token and its owner show here in a moment.'
      )
    ).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: 'Mint article NFT' })
    ).toHaveCount(0)
    // Once the owner record arrives, the minted token shows.
    await expect(panel(page).getByText('Token', { exact: true })).toBeVisible({
      timeout: 8_000,
    })
    await expect(
      panel(page).getByRole('button', { name: 'Mint article NFT' })
    ).toHaveCount(0)
  })

  test('a resumed mint that sent nothing does not call it a payment', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible&resume=mint:FAILED')
    await expect(
      panel(page).getByText(
        'Quilltip recorded no mint for this request. Nothing was sent.'
      )
    ).toBeVisible()
    await expect(panel(page).getByText(/recorded no payment/)).toHaveCount(0)
  })

  test('without the client NFT contract, the panel says minting is not available', async ({
    page,
  }) => {
    await open(page, 'state=author-eligible&clientNft=none')
    await expect(
      panel(page).getByText('Minting isn’t available on this site yet')
    ).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: 'Mint article NFT' })
    ).toHaveCount(0)
    expect((await log(page)).prepared).toEqual([])
  })

  test('without the client NFT contract, the owner is not offered a transfer', async ({
    page,
  }) => {
    await open(page, 'state=owner&clientNft=none')
    await expect(
      panel(page).getByText('Transfers aren’t available on this site yet')
    ).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: 'Transfer NFT' })
    ).toHaveCount(0)
  })
})
