/**
 * Records contract failures on a local standalone network for the error
 * decoder (`lib/stellar/v2/errors.ts`): the simulation error text and its
 * diagnostic events, and one transaction that fails on chain with its
 * result diagnostics. Core, the Stellar Asset Contract and the article NFT
 * share error numbers, so each failure is decoded with the contract that
 * raised it.
 *
 * It runs in `bun run test:local-network`. To refresh the unit-test fixture
 * (scripts/stellar/fixtures/contract-errors.json) on a running local network:
 *
 *   QUILLTIP_NETWORK_GUARD_OPT_IN=local QUILLTIP_WASM_DIR=<dir with the Wasm> \
 *   QUILLTIP_ERROR_FIXTURES_OUT=scripts/stellar/fixtures/contract-errors.json \
 *     bunx vitest run --config scripts/integration/contract-errors.config.mts
 *
 * Without QUILLTIP_ERROR_FIXTURES_OUT the run only checks the decoder.
 */
import { writeFileSync } from 'fs'
import { join } from 'path'

import {
  Asset,
  Keypair,
  Operation,
  TransactionBuilder,
  xdr,
  nativeToScVal,
  type Transaction,
} from '@stellar/stellar-sdk'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { articleId, articleRef } from '../../lib/stellar/v2/ids'
import { publicKeyOf } from '../../lib/stellar/v2/tab/encoding'
import {
  describeContractFailure,
  raisingContract,
  type ContractKind,
} from '../../lib/stellar/v2/errors'
import {
  describeTransactionFailure,
  needsMoreXlm,
} from '../../lib/stellar/v2/failure-events'
import { Harness, LOCAL_PASSPHRASE, XLM, scAddress } from './harness'

const wasmDir = process.env.QUILLTIP_WASM_DIR ?? ''
const outFile = process.env.QUILLTIP_ERROR_FIXTURES_OUT ?? ''

const h = new Harness()
const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n))
const bytes = (b: Uint8Array) => xdr.ScVal.scvBytes(b as never)
const i128 = (n: bigint) => nativeToScVal(n, { type: 'i128' })
const u32 = (n: number) => nativeToScVal(n, { type: 'u32' })

type Recorded = {
  /** What the scenario does, and the contract expected to raise the code. */
  case: string
  raisedBy: ContractKind
  code: number
  /** `simulateTransaction` error text. */
  error: string
  /** Base64 `DiagnosticEvent` XDR, in RPC order. */
  events: string[]
}

type RecordedResult = {
  case: string
  raisedBy: ContractKind
  code: number
  /** `getTransaction` result XDR (base64) and diagnostic events. */
  resultXdr: string
  events: string[]
}

let admin: Keypair, treasury: Keypair, author: Keypair, tipper: Keypair
let token: string, coreId: string, tabId: string, nftId: string
let A1: Uint8Array
const simulations: Recorded[] = []
const results: RecordedResult[] = []

async function build(
  source: Keypair,
  contract: string,
  fn: string,
  args: xdr.ScVal[]
): Promise<Transaction> {
  const account = await h.server.getAccount(source.publicKey())
  return new TransactionBuilder(account, {
    fee: '10000000',
    networkPassphrase: LOCAL_PASSPHRASE,
  })
    .addOperation(
      Operation.invokeContractFunction({ contract, function: fn, args })
    )
    .setTimeout(120)
    .build()
}

/** Simulates a call that must fail and records the raw response. */
async function failing(
  label: string,
  raisedBy: ContractKind,
  code: number,
  tx: Transaction
): Promise<Recorded> {
  const raw = await h.server._simulateTransaction(tx)
  expect(raw.error, label).toBeTruthy()
  expect(raw.error).toContain(`Error(Contract, #${code})`)
  const rec: Recorded = {
    case: label,
    raisedBy,
    code,
    error: raw.error!,
    events: raw.events ?? [],
  }
  simulations.push(rec)
  return rec
}

const tipArgs = (
  from: Keypair,
  amount: bigint,
  ref: Uint8Array,
  article = A1
) => [
  scAddress(from.publicKey()),
  bytes(article),
  scAddress(token),
  i128(amount),
  xdr.ScVal.scvVoid(),
  bytes(ref),
]

async function sendSigned(tx: Transaction, kp: Keypair) {
  tx.sign(kp)
  const sent = await h.server.sendTransaction(tx)
  expect(sent.status).toBe('PENDING')
  for (let i = 0; i < 60; i++) {
    const res = await h.server._getTransaction(sent.hash)
    if (res.status !== 'NOT_FOUND') return res
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`transaction ${sent.hash} not found`)
}

beforeAll(async () => {
  expect(wasmDir, 'QUILLTIP_WASM_DIR').not.toBe('')
  await h.assertLocalNetwork()
  ;[admin, treasury, author, tipper] = (await h.accounts(4)) as [
    Keypair,
    Keypair,
    Keypair,
    Keypair,
  ]
  token = h.ensureNativeSac(admin)
  const roles = {
    admin: admin.publicKey(),
    pauser: admin.publicKey(),
    upgrader: admin.publicKey(),
  }
  coreId = h.deploy(
    h.uploadWasm(join(wasmDir, 'quilltip_core.wasm'), admin),
    admin,
    { ...roles, treasury: treasury.publicKey(), token, min_tip: '1000000' }
  )
  tabId = h.deploy(
    h.uploadWasm(join(wasmDir, 'quilltip_tab.wasm'), admin),
    admin,
    {
      ...roles,
      settler: admin.publicKey(),
      token,
      treasury: treasury.publicKey(),
      // Above a funded account's 10,000 XLM, so a large deposit reaches the
      // token transfer instead of the tab limit.
      max_balance: (BigInt(100_000) * XLM).toString(),
      min_deposit: XLM.toString(),
      acceptor_key: Array.from(publicKeyOf(rand(32)), (b) =>
        b.toString(16).padStart(2, '0')
      ).join(''),
    }
  )
  nftId = h.deploy(
    h.uploadWasm(join(wasmDir, 'quilltip_article_nft.wasm'), admin),
    admin,
    {
      ...roles,
      core: coreId,
      threshold_token: token,
      threshold: (BigInt(50) * XLM).toString(),
      base_uri: 'https://www.quilltip.me/api/nft/',
    }
  )
  const ref = articleRef('error-fixtures-article')
  A1 = articleId(author.publicKey(), ref)
  const register = await build(author, coreId, 'register_article', [
    scAddress(author.publicKey()),
    bytes(ref),
    bytes(rand(32)),
    xdr.ScVal.scvVoid(),
    xdr.ScVal.scvVec([]),
  ])
  const prepared = await h.server.prepareTransaction(register)
  const res = await sendSigned(prepared as Transaction, author)
  expect(res.status).toBe('SUCCESS')
}, 600_000)

afterAll(() => {
  if (!outFile) return
  writeFileSync(
    outFile,
    JSON.stringify(
      {
        network: LOCAL_PASSPHRASE,
        contracts: { core: coreId, tab: tabId, nft: nftId, token },
        simulations,
        results,
      },
      null,
      2
    ) + '\n'
  )
})

describe('contract failures on the local network', () => {
  it('Core DuplicateClientRef (#10)', async () => {
    const ref = rand(16)
    const first = await h.server.prepareTransaction(
      await build(tipper, coreId, 'tip', tipArgs(tipper, XLM, ref))
    )
    expect((await sendSigned(first as Transaction, tipper)).status).toBe(
      'SUCCESS'
    )
    await failing(
      'core tip repeats a client_ref',
      'core',
      10,
      await build(tipper, coreId, 'tip', tipArgs(tipper, XLM, ref))
    )
  })

  it('Core BelowMinimum (#8)', async () => {
    await failing(
      'core tip below the minimum',
      'core',
      8,
      await build(
        tipper,
        coreId,
        'tip',
        tipArgs(tipper, BigInt(999_999), rand(16))
      )
    )
  })

  it('token BalanceError (#10) under Core.tip', async () => {
    await failing(
      'core tip above the tipper balance',
      'token',
      10,
      await build(
        tipper,
        coreId,
        'tip',
        tipArgs(tipper, BigInt(20_000) * XLM, rand(16))
      )
    )
  })

  it('token BalanceError (#10) under Tab.open_session', async () => {
    const until = (await h.latestLedger()) + 20_000
    await failing(
      'tab open_session above the reader balance',
      'token',
      10,
      await build(tipper, tabId, 'open_session', [
        scAddress(tipper.publicKey()),
        i128(BigInt(20_000) * XLM),
        bytes(publicKeyOf(rand(32))),
        u32(until),
        i128(BigInt(10) * XLM),
      ])
    )
  })

  it('Tab DepositTooSmall (#31)', async () => {
    const until = (await h.latestLedger()) + 20_000
    await failing(
      'tab open_session below the minimum deposit',
      'tab',
      31,
      await build(tipper, tabId, 'open_session', [
        scAddress(tipper.publicKey()),
        i128(BigInt(1_000)),
        bytes(publicKeyOf(rand(32))),
        u32(until),
        i128(BigInt(10) * XLM),
      ])
    )
  })

  it('NFT BelowThreshold (#70)', async () => {
    await failing(
      'nft mint below the tip threshold',
      'nft',
      70,
      await build(author, nftId, 'mint', [bytes(A1)])
    )
  })

  it('token BalanceError (#10) in a transaction result', async () => {
    // Simulated while the balance covers the tip, applied after a payment
    // that runs first (the next sequence number) has spent most of it.
    const payer = await h.account()
    const account = await h.server.getAccount(payer.publicKey())
    const drain = new TransactionBuilder(account, {
      fee: '1000',
      networkPassphrase: LOCAL_PASSPHRASE,
    })
      .addOperation(
        Operation.payment({
          destination: treasury.publicKey(),
          asset: Asset.native(),
          amount: '5000',
        })
      )
      .setTimeout(120)
      .build()
    const tip = (await h.server.prepareTransaction(
      new TransactionBuilder(account, {
        fee: '10000000',
        networkPassphrase: LOCAL_PASSPHRASE,
      })
        .addOperation(
          Operation.invokeContractFunction({
            contract: coreId,
            function: 'tip',
            args: tipArgs(payer, BigInt(9_000) * XLM, rand(16)),
          })
        )
        .setTimeout(120)
        .build()
    )) as Transaction
    expect((await sendSigned(drain, payer)).status).toBe('SUCCESS')
    const res = await sendSigned(tip, payer)
    expect(res.status).toBe('FAILED')
    const raw = res as unknown as {
      resultXdr: string
      diagnosticEventsXdr?: string[]
      events?: { diagnosticEventsXdr?: string[] }
    }
    results.push({
      case: 'core tip whose balance was spent before it was applied',
      raisedBy: 'token',
      code: 10,
      resultXdr: raw.resultXdr,
      events: raw.events?.diagnosticEventsXdr ?? raw.diagnosticEventsXdr ?? [],
    })
  })

  it('decodes each failure with the contract that raised it', () => {
    const contracts = { core: coreId, tab: tabId, nft: nftId, token }
    for (const s of simulations) {
      const events = s.events.map((e) =>
        xdr.DiagnosticEvent.fromXDR(e, 'base64')
      )
      const info = describeContractFailure(s.error, {
        raisedBy: raisingContract(events),
        contracts,
      })
      expect([s.case, info.contract, info.code]).toEqual([
        s.case,
        s.raisedBy,
        s.code,
      ])
    }
    for (const r of results) {
      const info = describeTransactionFailure(r.events, contracts)
      expect([r.case, info.contract, info.code]).toEqual([
        r.case,
        r.raisedBy,
        r.code,
      ])
      expect(needsMoreXlm(info)).toBe(true)
    }
    expect(results).toHaveLength(1)
  })
})
