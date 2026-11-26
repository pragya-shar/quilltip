/// <reference types="vite/client" />
/**
 * The tab screens' calls end to end on a local network (issue #449):
 * open a tab, register a quick-tip key, three tab tips signed by the browser
 * tab library, settlement by the settler code, the writer's claim, closing
 * the tab, and the withdrawal after the 3-day delay. Every balance is
 * checked on chain, to the stroop.
 *
 * What runs for real:
 * - The Tab contract on Quickstart, called through the same code the screens
 *   use: `tabContractCall` (lib/tab-ui/tab-calls.ts) and `sendContractCall`,
 *   with the wallet replaced by a local keypair.
 * - The browser tab library (`signTabTip`, `commitAcceptedTip`) over
 *   fake-indexeddb with Node WebCrypto.
 * - The settler run (`runSettlementCycle`, local-key submitter).
 * - The Convex indexer and the tab screens' read models
 *   (`tabs.getMyTab`, `tabActivity.*`) in convex-test, fed with the real
 *   events from `getEvents`.
 *
 * Not run here, as in tab-settlement.test.ts: `tabs.submitTip`. It signs
 * over the TESTNET network id, and this network is the standalone one, so
 * the accepted rows are written with the same encoders.
 *
 * The withdrawal itself needs `WITHDRAW_DELAY` (51,840 ledgers) to pass. A
 * local Quickstart network closes about one ledger a second and cannot skip
 * ledgers, so this test stops at the locked withdrawal: the contract refuses
 * it with `WithdrawLocked` before the unlock ledger, and nothing is signed.
 * The unlock itself is covered by the Tab contract's tests
 * (`contracts/tab/src/test/reader.rs`, which advance the ledger).
 *
 *   QUILLTIP_WASM_DIR=<dir> STELLAR_RPC_URL=http://localhost:8000/rpc \
 *     bunx vitest run --config scripts/integration/tab-ui.config.mts
 */
import { join } from 'path'

import { convexTest } from 'convex-test'
import { IDBFactory } from 'fake-indexeddb'
import { Keypair, TransactionBuilder, rpc } from '@stellar/stellar-sdk'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import schema from '../../convex/schema'
import { api, internal } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import type { ActionCtx, MutationCtx } from '../../convex/_generated/server'
import { createRpcClient, type RpcFetch } from '../../convex/lib/chain/rpc'
import { runSettlementCycle } from '../../convex/lib/chain/settler'
import { localKeySubmitter } from '../../convex/lib/chain/settlementSubmitter'
import { convexSettlementLedger } from '../../convex/tabSettler'
import { Client as TabClient } from '../../lib/stellar/v2/bindings/tab'
import { bytesToHex } from '../../lib/stellar/v2/tab/bytes'
import { publicKeyOf } from '../../lib/stellar/v2/tab/encoding'
import {
  commitAcceptedTip,
  createLocalLedger,
  createSessionKeyStore,
  receiptLeafHex,
  receiptsRootHex,
  signTabTip,
  type PreparedTabTip,
  type SessionKeyScope,
  type SignTabTipDeps,
  type StoredReceipt,
  type SubmittedTabTip,
} from '../../lib/stellar/v2/tab'
import {
  pollTransaction,
  sendContractCall,
  type TxOutcome,
} from '../../lib/stellar/v2/tx'
import { keyPlan } from '../../lib/tab-ui/key-plan'
import { tabContractCall } from '../../lib/tab-ui/tab-calls'
import type { TabCall } from '../../lib/tab-ui/types'
import { Harness, LOCAL_PASSPHRASE, XLM, metrics } from './harness'

const modules = import.meta.glob('../../convex/**/*.ts')

function run<R>(
  t: { run: (fn: never) => Promise<unknown> },
  fn: (ctx: MutationCtx) => Promise<R>
): Promise<R> {
  return t.run(fn as never) as Promise<R>
}

const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const EPOCH = 'testnet-local-tab-ui'
const TESTNET = 'Test SDF Network ; September 2015'
/** `WITHDRAW_DELAY` of the Tab contract: 3 days of 5-second ledgers. */
const WITHDRAW_DELAY_LEDGERS = 3 * 17_280
const feeOf = (x: bigint) => (x * BigInt(250)) / BigInt(10_000)

const h = new Harness()
const localRpc = createRpcClient({
  url: h.net.rpcUrl,
  fetch: fetch as unknown as RpcFetch,
})
const server = new rpc.Server(h.net.rpcUrl, { allowHttp: true })
let admin: Keypair, settler: Keypair, treasury: Keypair
let reader: Keypair, writer: Keypair
let tabId: string
const acceptorSeed = crypto.getRandomValues(new Uint8Array(32))
const view = (kp: Keypair) => new TabClient(h.opts(tabId, kp))

function convexEnv() {
  for (const [k, v] of Object.entries({
    STELLAR_NETWORK: 'TESTNET',
    NEXT_PUBLIC_STELLAR_NETWORK: 'TESTNET',
    NETWORK_PASSPHRASE: TESTNET,
    STELLAR_RPC_URL: '',
    QUILLTIP_NETWORK_GUARD_OPT_IN: '',
    CHAIN_V2_ENABLED: 'true',
    CHAIN_EPOCH: EPOCH,
    TAB_CONTRACT_ID: tabId,
    TOKEN_CONTRACT_ID: h.nativeSac,
    SETTLEMENT_ENABLED: 'true',
  })) {
    vi.stubEnv(k, v)
  }
}

/** The screens' call path with the wallet replaced by a local keypair. */
async function call(
  kp: Keypair,
  tabCall: TabCall
): Promise<{
  outcome: TxOutcome
  res?: rpc.Api.GetSuccessfulTransactionResponse
}> {
  const latest = await server.getLatestLedger()
  const maxTime = Number(latest.closeTime) + 300
  const outcome = await sendContractCall(
    {
      server,
      sign: async (envelope) => {
        const tx = TransactionBuilder.fromXDR(envelope, LOCAL_PASSPHRASE)
        tx.sign(kp)
        return tx.toXDR()
      },
    },
    tabContractCall({
      call: tabCall,
      source: kp.publicKey(),
      tabContractId: tabId,
      networkPassphrase: LOCAL_PASSPHRASE,
      maxTime,
    })
  )
  if (outcome.status !== 'sent') return { outcome }
  {
    const poll = await pollTransaction(
      {
        server,
        sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 500))),
      },
      outcome.hash,
      maxTime + 600
    )
    expect(poll).toBe('SUCCESS')
  }
  const res = (await server.getTransaction(
    outcome.hash
  )) as rpc.Api.GetSuccessfulTransactionResponse
  return { outcome, res }
}

beforeAll(async () => {
  expect(wasmDir, 'QUILLTIP_WASM_DIR').not.toBe('')
  await h.assertLocalNetwork()
  {
    ;[admin, settler, treasury, reader, writer] = (await h.accounts(5)) as [
      Keypair,
      Keypair,
      Keypair,
      Keypair,
      Keypair,
    ]
    const token = h.ensureNativeSac(admin)
    const tabHash = h.uploadWasm(join(wasmDir, 'quilltip_tab.wasm'), admin)
    tabId = h.deploy(tabHash, admin, {
      admin: admin.publicKey(),
      pauser: admin.publicKey(),
      upgrader: admin.publicKey(),
      settler: settler.publicKey(),
      token,
      treasury: treasury.publicKey(),
      max_balance: (BigInt(1_000) * XLM).toString(),
      min_deposit: XLM.toString(),
      acceptor_key: bytesToHex(publicKeyOf(acceptorSeed)),
    })
  }
}, 900_000)

describe('tab screens on a local network', () => {
  it('opens a tab, tips three times from a key, settles, collects, and closes with the withdrawal locked', async () => {
    const firstLedger = await h.latestLedger()
    convexEnv()
    const t = convexTest(schema, modules)
    const now = Date.now()
    const ids = await run(t, async (ctx) => {
      const user = (address: string, name: string) =>
        ctx.db.insert('users', {
          username: name,
          email: `${name}@example.test`,
          stellarAddress: address,
          stellarAddressVerifiedAt: now,
          stellarAddressVerifiedNetwork: TESTNET,
          createdAt: now,
          updatedAt: now,
        })
      const readerId = await user(reader.publicKey(), 'reader')
      const writerId = await user(writer.publicKey(), 'writer')
      const articleId = await ctx.db.insert('articles', {
        slug: 'on-tabs',
        title: 'On tabs',
        content: { type: 'doc', content: [] },
        published: true,
        authorId: writerId,
        authorUsername: 'writer',
        createdAt: now,
        updatedAt: now,
      })
      return { readerId, writerId, articleId }
    })
    const asReader = t.withIdentity({ subject: `${ids.readerId}|s` })
    const asWriter = t.withIdentity({ subject: `${ids.writerId}|s` })
    async function ingest() {
      {
        const health = await localRpc.getHealth()
        const page = await localRpc.getEvents({
          startLedger: Math.max(firstLedger, health.oldestLedger),
          filters: [{ type: 'contract', contractIds: [tabId] }],
          pagination: { limit: 1000 },
        })
        return t.mutation(internal.chain.indexer.ingestBackfill, {
          events: page.events,
        })
      }
    }
    const balances = async () => ({
      reader: await h.balance(reader.publicKey()),
      writer: await h.balance(writer.publicKey()),
      tab: await h.balance(tabId),
    })

    // The browser library's key store and ledger.
    const db = { indexedDB: new IDBFactory(), dbName: 'tab-ui-local' }
    const scope: SessionKeyScope = {
      tabContractId: tabId,
      readerAddress: reader.publicKey(),
    }
    const keys = createSessionKeyStore(db)
    const signing: SignTabTipDeps = {
      keys,
      ledger: createLocalLedger(db),
      networkPassphrase: LOCAL_PASSPHRASE,
      tabContractId: tabId,
      readerAddress: reader.publicKey(),
    }

    // 1. Open a tab with 10 XLM and a first key (`open_session`).
    const deposit = BigInt(10) * XLM
    const before = await balances()
    const first = await keys.generate(scope)
    const plan1 = keyPlan({
      latestLedger: await h.latestLedger(),
      tabBalanceAfter: deposit.toString(),
    })
    const opened = await call(reader, {
      method: 'open_session',
      amount: deposit.toString(),
      key: { publicKey: first.info.publicKey, ...plan1 },
    })
    const openFee = metrics('open', opened.res!).feeCharged
    const afterOpen = await balances()
    expect(before.reader - afterOpen.reader).toBe(deposit + openFee)
    expect(afterOpen.tab - before.tab).toBe(deposit)
    expect(
      (await view(admin).account({ reader: reader.publicKey() })).result
    ).toMatchObject({ balance: deposit })

    // 2. Set up quick tips on this device: a second key (`register_key`).
    const second = await keys.generate(scope)
    const plan2 = keyPlan({
      latestLedger: await h.latestLedger(),
      tabBalanceAfter: deposit.toString(),
    })
    const registered = await call(reader, {
      method: 'register_key',
      key: { publicKey: second.info.publicKey, ...plan2 },
    })
    const keyFee = metrics('register', registered.res!).feeCharged
    await ingest()
    let tab = await asReader.query(api.tabs.getMyTab, {})
    expect(tab?.status).toBe('OPEN')
    expect(tab?.confirmedBalance).toBe(deposit.toString())
    expect(tab?.keys.map((k) => [k.keyId, k.publicKey])).toEqual([
      [0, first.info.publicKey],
      [1, second.info.publicKey],
    ])
    expect(tab?.keys[1]?.spendLimit).toBe(plan2.spendLimit)
    await keys.bindKeyIds(scope, tab!.keys)
    expect((await keys.get(scope, 1))?.info.publicKey).toBe(
      second.info.publicKey
    )

    // 3. Three tab tips with key 1, signed by the library.
    const amounts = [BigInt(1_000_000), BigInt(2_500_000), BigInt(400_000)]
    let cumulative = BigInt(0)
    const leaves: string[] = []
    for (const [i, amount] of amounts.entries()) {
      const receipt: StoredReceipt = {
        amount: amount.toString(),
        articleId: 'aa'.repeat(32),
        clientRef: bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
        contentHash: 'bb'.repeat(32),
        cumulativeAfter: (cumulative + amount).toString(),
        highlightId: null,
        seq: i + 1,
      }
      const prepared: PreparedTabTip = {
        prepareId: `prep-${i}`,
        tabContractId: tabId,
        readerAddress: reader.publicKey(),
        writer: writer.publicKey(),
        keyId: 1,
        seq: i + 1,
        cumulativeBefore: cumulative.toString(),
        amount: amount.toString(),
        receipt,
        leafHashes: [...leaves],
        expiresAt: Date.now() + 300_000,
        existing: false,
      }
      const signed = await signTabTip(prepared, signing)
      expect(signed.kind).toBe('signed')
      if (signed.kind !== 'signed') return
      leaves.push(receiptLeafHex(receipt))
      cumulative += amount
      const root = receiptsRootHex(leaves)
      const accepted: SubmittedTabTip = {
        status: 'ACCEPTED',
        receiptId: `r${i}`,
        receipt,
        leafHashes: [...leaves],
        voucher: {
          tabContractId: tabId,
          reader: reader.publicKey(),
          writer: writer.publicKey(),
          keyId: 1,
          publicKey: second.info.publicKey,
          cumulative: cumulative.toString(),
          receiptsRoot: root,
          signature: signed.submit.signature,
          acceptor: bytesToHex(publicKeyOf(acceptorSeed)),
          acceptanceSignature: '00'.repeat(64),
        },
        alreadyAccepted: false,
      }
      await acceptRow(t, {
        ids,
        receipt,
        root,
        leaves,
        signature: signed.submit.signature,
        cumulative,
      })
      expect((await commitAcceptedTip(accepted, signing)).status).toBe(
        'committed'
      )
    }
    const committed = await signing.ledger.read(scope, 1, writer.publicKey())
    expect(committed?.committed?.seq).toBe(3)
    let tips = await asReader.query(api.tabActivity.getMyTabTips, {})
    expect(tips?.tips.map((r) => r.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
      'ACCEPTED',
    ])
    tab = await asReader.query(api.tabs.getMyTab, {})
    expect(tab?.outstanding).toBe(cumulative.toString())
    expect(tab?.available).toBe((deposit - cumulative).toString())

    // 4. The settler settles the pair.
    let settled
    {
      settled = await runSettlementCycle({
        holder: 'tab-ui-settler',
        passphrase: LOCAL_PASSPHRASE,
        tabContractId: tabId,
        ledger: convexSettlementLedger({
          runQuery: (ref: unknown, args: unknown) =>
            (t.query as (r: unknown, a: unknown) => Promise<unknown>)(
              ref,
              args
            ),
          runMutation: (ref: unknown, args: unknown) =>
            (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(
              ref,
              args
            ),
        } as unknown as ActionCtx),
        latestLedger: async () => {
          const health = await localRpc.getHealth()
          return {
            sequence: health.latestLedger,
            closeTime: health.latestLedgerCloseTime,
          }
        },
        submitter: localKeySubmitter({
          keypair: settler,
          passphrase: LOCAL_PASSPHRASE,
          tabContractId: tabId,
          server,
          rpcClient: localRpc,
        }),
        now: () => Date.now(),
        log: () => {},
        sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
        pollAttempts: 30,
      })
    }
    expect(settled).toMatchObject({ status: 'confirmed', submitted: 1 })
    await ingest()
    const fee = feeOf(cumulative)
    const net = cumulative - fee
    tips = await asReader.query(api.tabActivity.getMyTabTips, {})
    expect(tips?.tips.map((r) => r.status)).toEqual([
      'SETTLED',
      'SETTLED',
      'SETTLED',
    ])
    expect(tips?.tips.every((r) => typeof r.settledTxHash === 'string')).toBe(
      true
    )
    expect(tips?.oldestUnsettledAt).toBeNull()
    const earnings = await asWriter.query(api.tabActivity.getMyTabEarnings, {})
    expect(earnings).toMatchObject({
      settledGross: cumulative.toString(),
      fee: fee.toString(),
      earnedNet: net.toString(),
      pendingNet: '0',
      collected: '0',
    })
    expect(
      (await view(admin).claimable({ owner: writer.publicKey() })).result
    ).toBe(net)
    expect(
      (await view(admin).claimable({ owner: treasury.publicKey() })).result
    ).toBe(fee)
    expect(
      (await view(admin).account({ reader: reader.publicKey() })).result
        ?.balance
    ).toBe(deposit - cumulative)

    // 5. The writer collects (`claim`), signed by the writer.
    const beforeClaim = await balances()
    const claimed = await call(writer, { method: 'claim' })
    const claimFee = metrics('claim', claimed.res!).feeCharged
    const afterClaim = await balances()
    expect(afterClaim.writer - beforeClaim.writer).toBe(net - claimFee)
    expect(beforeClaim.tab - afterClaim.tab).toBe(net)
    expect(
      (await view(admin).claimable({ owner: writer.publicKey() })).result
    ).toBe(BigInt(0))
    await ingest()
    expect(
      (await asWriter.query(api.tabActivity.getMyTabEarnings, {}))?.collected
    ).toBe(net.toString())

    // 6. The reader closes the tab (`withdraw_start`).
    const closing = await call(reader, { method: 'withdraw_start' })
    const closeFee = metrics('close', closing.res!).feeCharged
    const unlock = closing.res!.ledger + WITHDRAW_DELAY_LEDGERS
    await ingest()
    tab = await asReader.query(api.tabs.getMyTab, {})
    expect(tab?.status).toBe('CLOSING')
    expect(tab?.withdrawUnlockLedger).toBe(unlock)
    // Before the unlock ledger the simulation refuses it: nothing is signed.
    const early = await call(reader, { method: 'withdraw' })
    expect(early.outcome).toMatchObject({
      status: 'simulation_failed',
      error: { name: 'WithdrawLocked' },
    })

    // What stays in the Tab: the reader's rest (locked until the unlock
    // ledger) and the treasury's fee.
    const rest = deposit - cumulative
    expect((await balances()).tab - before.tab).toBe(rest + fee)
    expect(
      (await view(admin).account({ reader: reader.publicKey() })).result
    ).toMatchObject({ balance: rest, withdraw_unlock: unlock })
    // The reader paid the deposit and four network fees so far.
    expect(before.reader - (await balances()).reader).toBe(
      deposit + openFee + keyFee + closeFee
    )
  })
})

/** Writes what `tabs.submitTip` stores for an accepted tab tip. */
async function acceptRow(
  t: ReturnType<typeof convexTest>,
  a: {
    ids: {
      readerId: Id<'users'>
      writerId: Id<'users'>
      articleId: Id<'articles'>
    }
    receipt: StoredReceipt
    root: string
    leaves: string[]
    signature: string
    cumulative: bigint
  }
) {
  const now = Date.now()
  await run(t, async (ctx) => {
    const account = (await ctx.db
      .query('tabAccounts')
      .withIndex('by_reader', (q) => q.eq('readerAddress', reader.publicKey()))
      .first())!
    const key = (await ctx.db
      .query('tabSessionKeys')
      .withIndex('by_account_key', (q) =>
        q.eq('tabAccountId', account._id).eq('keyId', 1)
      )
      .first())!
    const tipRowId = await ctx.db.insert('tips', {
      articleId: a.ids.articleId,
      tipperId: a.ids.readerId,
      authorId: a.ids.writerId,
      articleTitle: 'On tabs',
      articleSlug: 'on-tabs',
      amountUsd: 0.1,
      amountCents: 10,
      status: 'ACCEPTED',
      contractVersion: 'v2',
      channel: 'tab',
      clientRef: a.receipt.clientRef,
      grossBaseUnits: a.receipt.amount,
      createdAt: now,
      updatedAt: now,
    })
    await ctx.db.insert('tabReceipts', {
      network: 'TESTNET',
      chainEpoch: EPOCH,
      tabAccountId: account._id,
      keyId: 1,
      writerAddress: writer.publicKey(),
      authorId: a.ids.writerId,
      articleId: a.ids.articleId,
      articleKey: a.receipt.articleId,
      seq: a.receipt.seq,
      amount: a.receipt.amount,
      cumulativeAfter: a.receipt.cumulativeAfter,
      clientRef: a.receipt.clientRef,
      contentHash: a.receipt.contentHash,
      leafHash: receiptLeafHex(a.receipt),
      tipRowId,
      status: 'ACCEPTED',
      receiptsRoot: a.root,
      voucherSignature: a.signature,
      acceptorPublicKey: bytesToHex(publicKeyOf(acceptorSeed)),
      acceptanceSignature: '00'.repeat(64),
      // Older than 6 hours, so the pair is due.
      acceptedAt: now - 7 * 3600 * 1000,
      createdAt: now,
      updatedAt: now,
    })
    const existing = await ctx.db
      .query('tabVouchers')
      .withIndex('by_pair', (q) =>
        q
          .eq('tabAccountId', account._id)
          .eq('keyId', 1)
          .eq('writerAddress', writer.publicKey())
      )
      .first()
    const fields = {
      cumulative: a.cumulative.toString(),
      receiptsRoot: a.root,
      leafHashes: [...a.leaves],
      signature: a.signature,
      seq: a.receipt.seq,
      unsettled: true,
      oldestUnsettledAt: now - 7 * 3600 * 1000,
      settleQueue: 'ready' as const,
      updatedAt: now,
    }
    if (existing) {
      await ctx.db.patch(existing._id, fields)
    } else {
      await ctx.db.insert('tabVouchers', {
        network: 'TESTNET',
        chainEpoch: EPOCH,
        tabAccountId: account._id,
        tabContractId: tabId,
        tokenContractId: h.nativeSac,
        readerAddress: reader.publicKey(),
        keyId: 1,
        writerAddress: writer.publicKey(),
        authorId: a.ids.writerId,
        acceptance: {
          acceptor: bytesToHex(publicKeyOf(acceptorSeed)),
          signature: '00'.repeat(64),
        },
        paidOnChain: '0',
        settleBy: key.validUntilLedger + 7 * 17_280,
        state: 'ACTIVE',
        earnedNet: '0',
        pendingNet: '0',
        acceptedAt: now,
        ...fields,
      })
    }
    await ctx.db.patch(account._id, {
      outstanding: (
        BigInt(account.outstanding) + BigInt(a.receipt.amount)
      ).toString(),
    })
  })
}
