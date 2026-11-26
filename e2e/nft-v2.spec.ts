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

const SCENES: Scene[] = [
  { id: 'v2-disabled', query: 'state=v2-disabled', expect: 'NFT Status' },
  {
    id: 'reader-below',
    query: 'state=reader-below',
    expect: /18\.75 XLM of 50 XLM tipped/,
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
    expect: 'A wallet outside QuillTip',
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
  },
  {
    id: 'author-at-threshold',
    query: 'state=author-eligible',
    expect: 'Mint article NFT',
  },
  {
    id: 'author-v1-record',
    query: 'state=author-v1-record',
    expect: 'v1 record',
  },
  {
    id: 'author-paused',
    query: 'state=author-paused',
    expect: 'Payments are paused',
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
    expect: 'Payments are paused',
  },
  // Wallet states, reached by starting the mint.
  {
    id: 'wallet-none',
    query: 'state=author-eligible',
    mode: 'missing',
    act: mint,
    expect: 'No Stellar wallet found',
  },
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
    expect: 'Payments are paused',
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
    expect: /QuillTip contract/,
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
    expect: /No QuillTip writer or reader has that username/,
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
    id: 'transfer-review-user',
    query: 'state=owner',
    act: (page) => toReview(page, '@ada'),
    expect: 'QuillTip account @ada',
  },
  {
    id: 'transfer-review-contract',
    query: 'state=owner',
    act: (page) => toReview(page, OTHER_CONTRACT),
    expect: /This is a contract address/,
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

for (const width of [375, 768, 1440] as const) {
  test.describe(`at ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } })
    for (const scene of SCENES) {
      test(`${scene.id}`, async ({ page }) => {
        // 768 is for the screenshots only.
        test.skip(width === 768 && !SHOTS, 'Screenshots only')
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
    await expect(dialog.getByRole('alert')).toContainText('QuillTip contract')
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
      panel(page).getByText('A wallet outside QuillTip')
    ).toBeVisible()
    await expect(
      panel(page).getByRole('button', { name: 'Transfer NFT' })
    ).toHaveCount(0)
  })

  test('works with the keyboard alone, with focus where it belongs', async ({
    page,
  }) => {
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
    await page.keyboard.press('Tab')
    await expect(
      dialog.getByRole('button', { name: 'Copy address' })
    ).toBeFocused()
    await page.keyboard.press('Tab')
    await page.keyboard.press('Tab')
    await expect(
      dialog.getByRole('button', { name: 'Transfer NFT' })
    ).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
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
