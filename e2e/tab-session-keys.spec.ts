/**
 * Tab session keys and voucher signing in real engines (Chromium, Firefox,
 * WebKit), under the app's production content security policy.
 *
 *   bun e2e/fixtures/tab/server.mjs
 *   bunx playwright test --config e2e/fixtures/tab/playwright.config.ts
 */
import { ed25519 } from '@noble/curves/ed25519'
import { expect, test, type Page } from '@playwright/test'

import shared from '../contracts/shared/test-vectors.json'
import { hexToBytes } from '../lib/stellar/v2/tab/bytes'
import {
  receiptLeafHex,
  receiptsRootHex,
  voucherPayloadFor,
  type PreparedTabTip,
  type SubmittedTabTip,
  type SubmitTipArgs,
} from '../lib/stellar/v2/tab'

type Tip = {
  kind: string
  reason: string | null
  prepared: PreparedTabTip
  submit?: SubmitTipArgs
  receiptsRoot?: string
  publicKey?: string
}

/**
 * Stands in for Convex `submitTabTip` for one pair: it verifies the voucher
 * and accepts a tip only on top of the current pair state, so of two
 * vouchers for one seq it accepts at most one (spec 5.6, step 3.3).
 */
class PairServer {
  cumulative = BigInt(0)
  leafHashes: string[] = []
  accepted: bigint[] = []

  state() {
    return {
      cumulative: this.cumulative.toString(),
      leafHashes: [...this.leafHashes],
    }
  }

  submit(tip: Tip): SubmittedTabTip | 'TAB_STALE_PREPARE' {
    const p = tip.prepared
    if (
      p.seq !== this.leafHashes.length + 1 ||
      p.cumulativeBefore !== this.cumulative.toString()
    )
      return 'TAB_STALE_PREPARE'
    const leafHash = receiptLeafHex(p.receipt)
    const leafHashes = [...this.leafHashes, leafHash]
    const receiptsRoot = receiptsRootHex(leafHashes)
    const publicKey = hexToBytes(shared.keys.session.public_key, 32)
    const payload = voucherPayloadFor({
      tabContractId: p.tabContractId,
      networkPassphrase: shared.network.passphrase,
      reader: p.readerAddress,
      writer: p.writer,
      keyId: p.keyId,
      publicKey,
      cumulative: p.receipt.cumulativeAfter,
      receiptsRoot,
    })
    if (
      !ed25519.verify(hexToBytes(tip.submit!.signature, 64), payload, publicKey)
    )
      throw new Error('invalid voucher signature')
    this.leafHashes = leafHashes
    this.cumulative = BigInt(p.receipt.cumulativeAfter)
    this.accepted.push(BigInt(p.amount))
    return {
      status: 'ACCEPTED',
      receiptId: `r_${p.seq}`,
      receipt: p.receipt,
      leafHashes,
      voucher: {
        tabContractId: p.tabContractId,
        reader: p.readerAddress,
        writer: p.writer,
        keyId: p.keyId,
        publicKey: shared.keys.session.public_key,
        cumulative: p.receipt.cumulativeAfter,
        receiptsRoot,
        signature: tip.submit!.signature,
        acceptor: shared.keys.acceptor.public_key,
        acceptanceSignature: '00'.repeat(64),
      },
      alreadyAccepted: false,
    }
  }
}

async function open(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.locator('#status')).toHaveText('ready')
}

async function reload(page: Page): Promise<void> {
  await page.reload()
  await expect(page.locator('#status')).toHaveText('ready')
}

test.beforeEach(async ({ page }) => {
  await open(page)
  await page.evaluate(() => window.tabFixture.evict())
  await reload(page)
})

test('reports WebCrypto Ed25519 support and no CSP violations', async ({
  page,
  browser,
  browserName,
}) => {
  const support = await page.evaluate(() => window.tabFixture.support())
  console.log(
    `[tab-keys] ${browserName} ${browser.version()} WebCrypto Ed25519: ${support.webCryptoEd25519}`
  )
  expect(support.violations).toEqual([])
})

for (const forceFallback of [false, true]) {
  test(`the ${forceFallback ? 'fallback' : 'default'} vector key signs the shared vector, before and after a reload`, async ({
    page,
    browserName,
  }) => {
    const planted = await page.evaluate(
      (fallback) => window.tabFixture.plantVectorKey(fallback),
      forceFallback
    )
    const first = await page.evaluate(() => window.tabFixture.signVector())
    expect(first.payloadMatches).toBe(true)
    expect(first).toMatchObject({ found: true, verifies: true })
    expect(first.backend).toBe(planted.backend)
    console.log(
      `[tab-keys] ${browserName} ${planted.backend}: deterministic=${first.deterministic} equalsVector=${first.signature === first.expectedSignature}`
    )
    await reload(page)
    const second = await page.evaluate(() => window.tabFixture.signVector())
    expect(second).toMatchObject({ found: true, verifies: true })
    expect(second.publicKey).toBe(first.publicKey)
    // The fallback is RFC 8032 deterministic everywhere. A WebCrypto engine
    // that signs with a random nonce (WebKit) gives valid signatures that
    // differ from the vector bytes; byte equality is required otherwise.
    if (planted.backend === 'noble') expect(first.deterministic).toBe(true)
    if (first.deterministic) {
      expect(first.signature).toBe(first.expectedSignature)
      expect(second.signature).toBe(first.expectedSignature)
    }
  })
}

test('signTabTip reproduces the shared voucher through three receipts', async ({
  page,
}) => {
  await page.evaluate(() => window.tabFixture.plantVectorKey())
  const run = await page.evaluate(() => window.tabFixture.tipSequence())
  expect(run.steps.map((s) => s.kind)).toEqual(['signed', 'signed', 'signed'])
  expect(run.steps[2]!.root).toBe(run.expectedRoot)
  const { deterministic } = await page.evaluate(() =>
    window.tabFixture.signVector()
  )
  if (deterministic) expect(run.steps[2]!.signature).toBe(run.expectedSignature)
  await reload(page)
  const ledger = await page.evaluate(() => window.tabFixture.ledger())
  expect(ledger?.committed?.seq).toBe(3)
  expect(ledger?.committed?.cumulative).toBe('3900000')
})

for (const forceFallback of [false, true]) {
  test(`a generated ${forceFallback ? 'fallback' : 'default'} key persists across a reload`, async ({
    page,
  }) => {
    const created = await page.evaluate(
      (fallback) => window.tabFixture.generate(fallback),
      forceFallback
    )
    if (forceFallback) {
      expect(created.backend).toBe('noble')
      expect(created.extractable).toBe(true)
    } else {
      const { webCryptoEd25519 } = await page.evaluate(() =>
        window.tabFixture.support()
      )
      expect(created.backend).toBe(webCryptoEd25519 ? 'webcrypto' : 'noble')
      expect(created.extractable).toBe(!webCryptoEd25519)
    }
    const before = await page.evaluate(() => window.tabFixture.signGenerated())
    expect(before).toMatchObject({ found: true, verifies: true })
    await reload(page)
    const after = await page.evaluate(() => window.tabFixture.signGenerated())
    expect(after).toMatchObject({
      found: true,
      verifies: true,
      publicKey: created.publicKey,
      backend: created.backend,
    })
    expect(
      await page.evaluate(
        (pk) => window.tabFixture.status(7, pk),
        created.publicKey
      )
    ).toBe('ready')
  })
}

test('missing key: eviction leaves the server key unusable here', async ({
  page,
}) => {
  const created = await page.evaluate(() => window.tabFixture.generate(false))
  expect(await page.evaluate(() => window.tabFixture.tipWithKey(99))).toEqual({
    kind: 'stop',
    reason: 'key_missing',
    message: "This device's quick-tip key is gone.",
  })
  await page.evaluate(() => window.tabFixture.evict())
  await reload(page)
  expect(
    await page.evaluate(
      (pk) => window.tabFixture.status(7, pk),
      created.publicKey
    )
  ).toBe('missing')
  expect(
    await page.evaluate(() => window.tabFixture.tipWithKey(7))
  ).toMatchObject({ kind: 'stop', reason: 'key_missing' })
})

test('two browser tabs commit the same acceptance once', async ({
  page,
  context,
}) => {
  await page.evaluate(() => window.tabFixture.plantVectorKey())
  expect(
    await page.evaluate(() => window.tabFixture.recordFirstPending())
  ).toBe(true)
  const other = await context.newPage()
  await open(other)
  const statuses = await Promise.all([
    page.evaluate(() => window.tabFixture.commitFirst()),
    other.evaluate(() => window.tabFixture.commitFirst()),
  ])
  expect(statuses.sort()).toEqual(['already_committed', 'committed'])
  const ledger = await other.evaluate(() => window.tabFixture.ledger())
  expect(ledger?.committed?.seq).toBe(1)
  await other.close()
})

test('the generated WebCrypto key is stored non-extractable', async ({
  page,
}) => {
  const info = await page.evaluate(() => window.tabFixture.generate(false))
  expect(info).toMatchObject({ backend: 'webcrypto', extractable: false })
  const records = await page.evaluate(() => window.tabFixture.rawKeys())
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    backend: 'webcrypto',
    extractable: false,
    isCryptoKey: true,
    keyExtractable: false,
    usages: ['sign'],
    hasSeed: false,
  })
  for (const format of ['pkcs8', 'jwk', 'raw'])
    expect(records[0]!.exports[format]).not.toBe('exported')
})

test('a resubmit reuses the stored signature bytes', async ({
  page,
  browserName,
}) => {
  await page.evaluate(() => window.tabFixture.generate(false))
  const result = await page.evaluate(() => window.tabFixture.replay())
  expect(result).toMatchObject({
    first: 'signed',
    again: 'signed',
    replay: true,
    same: true,
    verifies: true,
  })
  // WebKit signs with a random nonce: a new signature would differ.
  console.log(
    `[tab-keys] ${browserName}: a fresh signature differs=${(result as { freshDiffers?: boolean }).freshDiffers}`
  )
})

test('two tabs tipping at once: at most one voucher per seq is accepted, the other tab retries', async ({
  page,
  context,
  browserName,
}) => {
  await page.evaluate(() => window.tabFixture.plantVectorKey())
  const other = await context.newPage()
  await open(other)
  const tabs = [page, other]
  const amounts = [3, 4]
  const rounds = 6
  let bothSigned = 0

  for (let round = 0; round < rounds; round++) {
    const server = new PairServer()
    const writer = await page.evaluate(
      (i) => window.tabFixture.writerOf(i),
      round
    )
    const state = server.state()
    const tips = (await Promise.all(
      tabs.map((tab, i) =>
        tab.evaluate(
          ([w, st, amount]) =>
            window.tabFixture.tipOn(
              w as string,
              st as { cumulative: string; leafHashes: string[] },
              amount as number
            ),
          [writer, state, amounts[i]!] as const
        )
      )
    )) as Tip[]
    // Both tabs may sign seq 1; nothing between them prevents it.
    for (const tip of tips)
      expect(
        tip.kind === 'signed' ||
          (tip.kind === 'retry_prepare' && tip.reason === 'concurrent_update')
      ).toBe(true)
    if (tips.every((t) => t.kind === 'signed')) bothSigned += 1

    // Convex serialises submits: at most one voucher for seq 1.
    const outcomes = tips.map((tip) =>
      tip.kind === 'signed' ? server.submit(tip) : null
    )
    const winners = outcomes.filter((o) => o && o !== 'TAB_STALE_PREPARE')
    expect(winners).toHaveLength(1)
    const winner = outcomes.findIndex((o) => o && o !== 'TAB_STALE_PREPARE')
    const loser = 1 - winner
    // On odd rounds the winner's response is lost: no commit.
    if (round % 2 === 0)
      expect(
        await tabs[winner]!.evaluate(
          (a) => window.tabFixture.commit(a),
          outcomes[winner] as SubmittedTabTip
        )
      ).toBe('committed')

    // The refused tab prepares again on the new state and is accepted.
    const retry = (await tabs[loser]!.evaluate(
      ([w, st, amount]) =>
        window.tabFixture.tipOn(
          w as string,
          st as { cumulative: string; leafHashes: string[] },
          amount as number
        ),
      [writer, server.state(), amounts[loser]!] as const
    )) as Tip
    expect(retry).toMatchObject({ kind: 'signed' })
    expect(retry.prepared.seq).toBe(2)
    const second = server.submit(retry)
    expect(second).not.toBe('TAB_STALE_PREPARE')
    expect(
      await tabs[loser]!.evaluate(
        (a) => window.tabFixture.commit(a),
        second as SubmittedTabTip
      )
    ).toBe('committed')

    // The reader paid exactly what both tabs meant to tip, once each.
    expect(server.accepted.map(String).sort()).toEqual(['3', '4'])
    expect(server.cumulative).toBe(BigInt(7))
    for (const tab of tabs) {
      const ledger = await tab.evaluate(
        (w) => window.tabFixture.ledgerFor(w),
        writer
      )
      expect(ledger?.committed).toMatchObject({
        seq: 2,
        cumulative: '7',
        leafHashes: server.leafHashes,
      })
    }
  }
  console.log(
    `[tab-keys] ${browserName}: both tabs signed seq 1 in ${bothSigned}/${rounds} rounds`
  )
  await other.close()
})
