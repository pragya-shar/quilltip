/// <reference types="vite/client" />
/**
 * Tab settlement end to end on a local standalone network
 * (docs/architecture/v2/03-tab-contract.md, sections 3.2 and 3.8).
 *
 * What runs for real:
 * - The Tab contract (`open_session`, `settle`, `claim` views) on Quickstart.
 * - The settler run (`runSettlementCycle`) with the `localKey` submitter, which
 *   simulates, signs with the settler key and sends through RPC.
 * - The Convex ledger functions, in convex-test: the indexer stores the real
 *   `Deposited`, `KeyRegistered`, `TabSettled` events from `getEvents`, and
 *   the settler's selection, begin, record and finish mutations.
 *
 * Not run here: voucher acceptance (`tabs.submitTip`). It signs over the
 * configured TESTNET network id, while this network is the standalone one, so
 * the accepted vouchers are written directly with the same encoder and the
 * standalone network id. The Convex functions see a TESTNET environment;
 * nothing in this file can reach testnet: every transaction goes to the local
 * RPC that the harness guard checked.
 *
 *   QUILLTIP_WASM_DIR=<dir> STELLAR_RPC_URL=http://localhost:8000/rpc \
 *     bunx vitest run --config scripts/integration/settlement.config.mts
 */
import { join } from 'path'
import { writeFileSync, mkdirSync } from 'fs'

import { convexTest } from 'convex-test'
import { Keypair, rpc } from '@stellar/stellar-sdk'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import schema from '../../convex/schema'
import { internal } from '../../convex/_generated/api'
import type { ActionCtx, MutationCtx } from '../../convex/_generated/server'
import { createRpcClient, type RpcFetch } from '../../convex/lib/chain/rpc'
import {
  MAX_SETTLE_BATCH,
  runSettlementCycle,
} from '../../convex/lib/chain/settler'
import { localKeySubmitter } from '../../convex/lib/chain/settlementSubmitter'
import {
  networkIdOf,
  receiptLeafHex,
  receiptsRootHex,
  voucherPayloadBytes,
  type StoredReceipt,
} from '../../convex/lib/chain/voucher'
import { bytesToHex, hexToBytes } from '../../convex/lib/chain/ids'
import { convexSettlementLedger } from '../../convex/tabSettler'
import { Client as TabClient } from '../../lib/stellar/v2/bindings/tab'
import { publicKeyOf, signEd25519 } from '../../lib/stellar/v2/tab/encoding'
import {
  Harness,
  LOCAL_PASSPHRASE,
  XLM,
  metrics,
  type TxMetrics,
} from './harness'

const modules = import.meta.glob('../../convex/**/*.ts')

/** `t.run` with the app's typed database context. */
function run<R>(
  t: { run: (fn: never) => Promise<unknown> },
  fn: (ctx: MutationCtx) => Promise<R>
): Promise<R> {
  return t.run(fn as never) as Promise<R>
}
const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const outDir = process.env.QUILLTIP_INTEGRATION_OUT ?? ''
const EPOCH = 'testnet-local-settlement'
const TESTNET = 'Test SDF Network ; September 2015'
const fee = (x: bigint) => (x * BigInt(250)) / BigInt(10_000)

const h = new Harness()
const localRpc = createRpcClient({
  url: h.net.rpcUrl,
  fetch: fetch as unknown as RpcFetch,
})
let admin: Keypair, settler: Keypair, treasury: Keypair
let tabId: string
const acceptorSeed = crypto.getRandomValues(new Uint8Array(32))
const tab = (kp: Keypair) => new TabClient(h.opts(tabId, kp))

/** Environment the Convex functions see: TESTNET, so the backend guard passes. */
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

beforeAll(async () => {
  expect(wasmDir, 'QUILLTIP_WASM_DIR').not.toBe('')
  await h.assertLocalNetwork()
  ;[admin, settler, treasury] = (await h.accounts(3)) as [
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
}, 600_000)

type Reader = { kp: Keypair; seed: Uint8Array; keyId: number }

async function openTab(deposit: bigint): Promise<Reader> {
  const kp = await h.account()
  const seed = crypto.getRandomValues(new Uint8Array(32))
  const latest = await h.latestLedger()
  const tx = await tab(kp).open_session({
    reader: kp.publicKey(),
    amount: deposit,
    public_key: Buffer.from(publicKeyOf(seed)),
    valid_until: latest + 7 * 17_280,
    spend_limit: deposit,
  })
  const sent = await tx.signAndSend()
  return { kp, seed, keyId: sent.result }
}

describe('settleDue end to end', () => {
  it('settles vouchers from several readers to several writers, to the stroop', async () => {
    const firstLedger = await h.latestLedger()
    // Readers 0..7 each tip writers 0..3 (32 pairs); reader 0 also tips writer 4.
    const readers = await Promise.all(
      Array.from({ length: 8 }, () => openTab(BigInt(20) * XLM))
    )
    const writers = await h.accounts(5)

    convexEnv()
    const t = convexTest(schema, modules)
    const now = Date.now()
    const userIds = new Map<string, string>()
    await run(t, async (ctx) => {
      for (const address of [
        ...readers.map((r) => r.kp.publicKey()),
        ...writers.map((w) => w.publicKey()),
      ]) {
        const id = await ctx.db.insert('users', {
          username: `u${address.slice(1, 9).toLowerCase()}`,
          email: `${address.slice(1, 9).toLowerCase()}@example.test`,
          stellarAddress: address,
          stellarAddressVerifiedAt: now,
          stellarAddressVerifiedNetwork: TESTNET,
          createdAt: now,
          updatedAt: now,
        })
        userIds.set(address, id)
      }
    })

    async function ingestChainEvents() {
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
    // The indexer creates accounts and keys from the real events.
    const opened = await ingestChainEvents()
    expect(opened.byResult.done).toBe(16)

    // Accepted vouchers: 1 to 3 receipts per pair, signed with the session keys.
    const plan: Array<{ reader: Reader; writer: string; amounts: bigint[] }> =
      []
    readers.forEach((reader, i) =>
      writers.slice(0, 4).forEach((w, j) =>
        plan.push({
          reader,
          writer: w.publicKey(),
          amounts: Array.from(
            { length: 1 + ((i + j) % 3) },
            (_, k) => XLM / BigInt(4) + BigInt(39 * (k + 1) + i * 7 + j)
          ),
        })
      )
    )
    plan.push({
      reader: readers[0]!,
      writer: writers[4]!.publicKey(),
      amounts: [BigInt(2) * XLM],
    })
    const expectedPaid = new Map<string, bigint>()
    await run(t, async (ctx) => {
      for (const p of plan) {
        const readerAddress = p.reader.kp.publicKey()
        const account = (await ctx.db
          .query('tabAccounts')
          .withIndex('by_reader', (q) => q.eq('readerAddress', readerAddress))
          .first())!
        const key = (await ctx.db
          .query('tabSessionKeys')
          .withIndex('by_account_key', (q) =>
            q.eq('tabAccountId', account._id).eq('keyId', p.reader.keyId)
          )
          .first())!
        let cumulative = BigInt(0)
        const receipts: StoredReceipt[] = p.amounts.map((amount, i) => {
          cumulative += amount
          return {
            amount: amount.toString(),
            articleId: 'aa'.repeat(32),
            clientRef: bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
            contentHash: 'bb'.repeat(32),
            cumulativeAfter: cumulative.toString(),
            highlightId: null,
            seq: i + 1,
          }
        })
        expectedPaid.set(`${readerAddress}|${p.writer}`, cumulative)
        const leafHashes = receipts.map(receiptLeafHex)
        const root = receiptsRootHex(leafHashes)
        const signature = bytesToHex(
          signEd25519(
            p.reader.seed,
            voucherPayloadBytes({
              tab: tabId,
              networkId: networkIdOf(LOCAL_PASSPHRASE),
              reader: readerAddress,
              writer: p.writer,
              keyId: p.reader.keyId,
              publicKey: hexToBytes(key.publicKey!),
              cumulative,
              receiptsRoot: hexToBytes(root),
            })
          )
        )
        const writerId = userIds.get(p.writer) as never
        const articleId = await ctx.db.insert('articles', {
          slug: `a-${receipts[0]!.clientRef}`,
          title: 'A',
          content: { type: 'doc', content: [] },
          published: true,
          authorId: writerId,
          authorUsername: 'w',
          createdAt: now,
          updatedAt: now,
        })
        for (const r of receipts) {
          const tipRowId = await ctx.db.insert('tips', {
            articleId,
            tipperId: userIds.get(readerAddress) as never,
            authorId: writerId,
            articleTitle: 'A',
            articleSlug: 'a',
            amountUsd: 0.1,
            amountCents: 10,
            status: 'ACCEPTED',
            contractVersion: 'v2',
            channel: 'tab',
            clientRef: r.clientRef,
            grossBaseUnits: r.amount,
            createdAt: now,
            updatedAt: now,
          })
          await ctx.db.insert('tabReceipts', {
            network: 'TESTNET',
            chainEpoch: EPOCH,
            tabAccountId: account._id,
            keyId: p.reader.keyId,
            writerAddress: p.writer,
            authorId: writerId,
            articleId,
            articleKey: r.articleId,
            seq: r.seq,
            amount: r.amount,
            cumulativeAfter: r.cumulativeAfter,
            clientRef: r.clientRef,
            contentHash: r.contentHash,
            leafHash: receiptLeafHex(r),
            tipRowId,
            status: 'ACCEPTED',
            receiptsRoot: root,
            voucherSignature: signature,
            acceptorPublicKey: bytesToHex(publicKeyOf(acceptorSeed)),
            acceptanceSignature: '00'.repeat(64),
            acceptedAt: now - 7 * 3600 * 1000,
            createdAt: now,
            updatedAt: now,
          })
        }
        await ctx.db.insert('tabVouchers', {
          network: 'TESTNET',
          chainEpoch: EPOCH,
          tabAccountId: account._id,
          tabContractId: tabId,
          tokenContractId: h.nativeSac,
          readerAddress,
          keyId: p.reader.keyId,
          writerAddress: p.writer,
          authorId: writerId,
          cumulative: cumulative.toString(),
          receiptsRoot: root,
          leafHashes,
          signature,
          acceptance: {
            acceptor: bytesToHex(publicKeyOf(acceptorSeed)),
            signature: '00'.repeat(64),
          },
          seq: receipts.length,
          paidOnChain: '0',
          unsettled: true,
          // Older than 6 hours: every pair is due.
          oldestUnsettledAt: now - 7 * 3600 * 1000,
          settleBy: key.validUntilLedger + 7 * 17_280,
          settleQueue: 'ready',
          state: 'ACTIVE',
          earnedNet: '0',
          pendingNet: '0',
          acceptedAt: now,
          updatedAt: now,
        })
        await ctx.db.patch(account._id, {
          outstanding: (BigInt(account.outstanding) + cumulative).toString(),
        })
      }
    })

    // Two settler runs with the real local-key submitter.
    const server = new rpc.Server(h.net.rpcUrl, { allowHttp: true })
    const submitter = localKeySubmitter({
      keypair: settler,
      passphrase: LOCAL_PASSPHRASE,
      tabContractId: tabId,
      server,
      rpcClient: localRpc,
    })
    const ledger = convexSettlementLedger({
      runQuery: (ref: unknown, args: unknown) =>
        (t.query as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
      runMutation: (ref: unknown, args: unknown) =>
        (t.mutation as (r: unknown, a: unknown) => Promise<unknown>)(ref, args),
    } as unknown as ActionCtx)
    const logs: unknown[] = []
    const deps = {
      holder: 'local-settler',
      passphrase: LOCAL_PASSPHRASE,
      tabContractId: tabId,
      ledger,
      latestLedger: async () => {
        const health = await localRpc.getHealth()
        return {
          sequence: health.latestLedger,
          closeTime: health.latestLedgerCloseTime,
        }
      },
      submitter,
      now: () => Date.now(),
      log: (code: string, d: Record<string, unknown>) =>
        logs.push({ code, ...d }),
      sleep: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
      pollAttempts: 12,
    }
    const first = await runSettlementCycle(deps)
    expect(first).toMatchObject({
      status: 'confirmed',
      submitted: MAX_SETTLE_BATCH,
      rejected: 0,
    })
    const second = await runSettlementCycle(deps)
    expect(second).toMatchObject({ status: 'confirmed', submitted: 1 })
    expect((await runSettlementCycle(deps)).status).toBe('nothing_due')

    const settlements = await run(t, async (ctx) =>
      ctx.db.query('tabSettlements').collect()
    )
    expect(settlements.map((s) => [s.status, s.settled, s.skipped])).toEqual([
      ['CONFIRMED', 32, 0],
      ['CONFIRMED', 1, 0],
    ])
    const measured: TxMetrics[] = []
    for (const s of settlements) {
      const res = await server.getTransaction(s.txHash!)
      expect(res.status).toBe(rpc.Api.GetTransactionStatus.SUCCESS)
      measured.push(
        metrics(
          `settleDue_${s.settled}`,
          res as rpc.Api.GetSuccessfulTransactionResponse
        )
      )
    }

    // The indexer applies the same events: balances follow the chain.
    await ingestChainEvents()

    // On chain, to the stroop: each reader, each writer, the treasury, the Tab.
    let totalFee = BigInt(0)
    const owed = new Map<string, bigint>()
    for (const [pair, paid] of expectedPaid) {
      const writer = pair.split('|')[1]!
      totalFee += fee(paid)
      owed.set(writer, (owed.get(writer) ?? BigInt(0)) + paid - fee(paid))
    }
    for (const r of readers) {
      const spent = [...expectedPaid]
        .filter(([pair]) => pair.startsWith(`${r.kp.publicKey()}|`))
        .reduce((sum, [, paid]) => sum + paid, BigInt(0))
      const onChain = (await tab(r.kp).account({ reader: r.kp.publicKey() }))
        .result!
      expect(onChain.balance).toBe(BigInt(20) * XLM - spent)
      const row = await run(t, async (ctx) =>
        ctx.db
          .query('tabAccounts')
          .withIndex('by_reader', (q) =>
            q.eq('readerAddress', r.kp.publicKey())
          )
          .first()
      )
      expect(row).toMatchObject({
        confirmedBalance: onChain.balance.toString(),
        outstanding: '0',
      })
    }
    for (const w of writers) {
      const claimable = (await tab(w).claimable({ owner: w.publicKey() }))
        .result
      expect(claimable).toBe(owed.get(w.publicKey()))
      const earnings = await run(t, async (ctx) =>
        ctx.db
          .query('authorEarnings')
          .withIndex('by_user', (q) =>
            q.eq('userId', userIds.get(w.publicKey()) as never)
          )
          .first()
      )
      // 97.5% to the writer under the cumulative fee rule, per pair.
      expect(earnings!.earnedBaseUnits![h.nativeSac]).toBe(
        owed.get(w.publicKey())!.toString()
      )
      expect(earnings!.pendingBaseUnits?.[h.nativeSac] ?? '0').toBe('0')
    }
    const treasuryClaimable = (
      await tab(treasury).claimable({ owner: treasury.publicKey() })
    ).result
    expect(treasuryClaimable).toBe(totalFee)
    // 2.5% in total, within the rounding of each pair.
    const gross = [...expectedPaid.values()].reduce((a, b) => a + b, BigInt(0))
    expect(totalFee).toBe(
      [...expectedPaid.values()].reduce((a, b) => a + fee(b), BigInt(0))
    )
    expect(gross - totalFee).toBe(
      [...owed.values()].reduce((a, b) => a + b, BigInt(0))
    )
    // Conservation: the Tab holds the reader balances plus everything claimable.
    const readerBalances = BigInt(8) * BigInt(20) * XLM - gross
    expect(await h.balance(tabId)).toBe(readerBalances + gross)
    const receiptsLeft = await run(t, async (ctx) =>
      (await ctx.db.query('tabReceipts').collect()).filter(
        (r) => r.status !== 'SETTLED'
      )
    )
    expect(receiptsLeft).toHaveLength(0)

    if (outDir) {
      mkdirSync(outDir, { recursive: true })
      writeFileSync(
        join(outDir, 'settlement-measurements.json'),
        JSON.stringify(
          { measured, logs },
          (_k, x) => (typeof x === 'bigint' ? x.toString() : x),
          2
        )
      )
    }
    console.log(
      JSON.stringify(
        measured.map((m) => ({
          label: m.label,
          instructions: m.instructions,
          writeBytes: m.writeBytes,
          readWriteEntries: m.readWriteEntries,
          eventBytes: m.eventBytes,
          feeCharged: m.feeCharged.toString(),
        }))
      )
    )
    vi.unstubAllEnvs()
  })
})
