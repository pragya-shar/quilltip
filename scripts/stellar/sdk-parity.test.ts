/**
 * Encode and decode parity for every Stellar SDK path the app uses.
 *
 * `fixtures/sdk-baseline.json` holds the observations recorded with the
 * previous SDK major (14.6.1). This suite recomputes the ones whose code is
 * still in the app (the practice flow and the Horizon verifier) and compares
 * them with the baseline. The v1 client builders were removed with the v1
 * tip code; their recorded observations stay in the file for reference.
 *
 * Re-record only on purpose: `STELLAR_BASELINE=record bun run test:unit`.
 *
 * No network access: Horizon and RPC servers are replaced with local fakes,
 * and the testnet transactions in `fixtures/testnet-transactions.json` were
 * fetched once, read-only, from Horizon testnet.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as RealSdk from '@stellar/stellar-sdk'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { TipInvocationExpectations } from '../../convex/lib/horizon'

const FIXTURE_DIR = join(__dirname, 'fixtures')
const BASELINE_PATH = join(FIXTURE_DIR, 'sdk-baseline.json')
const RECORD = process.env.STELLAR_BASELINE === 'record'

const NFT_CONTRACT_ID =
  'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const FIXED_NOW_MS = 1_780_000_000_000
const SEQUENCE = '123456789'

type Observations = Record<string, unknown>
type VerifyCases = Record<string, unknown>

type TestnetTransaction = {
  hash: string
  function: string
  source_account: string
  ledger: number
  created_at: string
  successful: boolean
  envelope_xdr: string
  result_xdr: string
}

const testnet = JSON.parse(
  readFileSync(join(FIXTURE_DIR, 'testnet-transactions.json'), 'utf8')
) as { transactions: TestnetTransaction[] }

// Deterministic throwaway keys derived from constant seeds. They hold no
// funds and never sign anything that leaves this process.
function seedKeypair(fill: number) {
  return RealSdk.Keypair.fromRawEd25519Seed(
    Buffer.alloc(32, fill) as Parameters<
      typeof RealSdk.Keypair.fromRawEd25519Seed
    >[0]
  )
}
const tipper = seedKeypair(1)
const secondAuthor = seedKeypair(3)
const feeSource = seedKeypair(4)

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}

// Wrapper and XDR classes are spelled toXDR in one SDK major and toXdr in the
// next. These helpers keep the suite itself identical across the port.
type XdrWritable = {
  toXdr?: (format?: 'base64') => string | Uint8Array
  toXDR?: (format?: 'base64') => string | Uint8Array
}
function toBase64(value: unknown): string {
  const writable = value as XdrWritable
  const out = writable.toXdr
    ? writable.toXdr('base64')
    : writable.toXDR!('base64')
  return typeof out === 'string' ? out : Buffer.from(out).toString('base64')
}
type FromXdr = (
  envelope: string,
  networkPassphrase: string
) => RealSdk.Transaction | RealSdk.FeeBumpTransaction
function parseTransaction(envelope: string): RealSdk.Transaction {
  const builder = RealSdk.TransactionBuilder as unknown as {
    fromXdr?: FromXdr
    fromXDR?: FromXdr
  }
  const fromXdr = (builder.fromXdr ?? builder.fromXDR)!
  return fromXdr(envelope, RealSdk.Networks.TESTNET) as RealSdk.Transaction
}
function readField(value: unknown, key: string): unknown {
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'function'
    ? (field as () => unknown).call(value)
    : field
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, function (key, inner) {
      // JSON.stringify calls Buffer#toJSON before the replacer sees it.
      const raw = (this as Record<string, unknown>)[key]
      if (raw instanceof Uint8Array) return `bytes:${hex(raw)}`
      if (typeof inner === 'bigint') return `${inner}n`
      return inner
    })
  )
}

// ---------------------------------------------------------------------------
// Observation builders
// ---------------------------------------------------------------------------
function decodeInvocation(envelope: string) {
  const tx = parseTransaction(envelope)
  const op = tx.operations[0] as unknown as { func: unknown }
  const hostFunction = RealSdk.xdr.HostFunction.fromXDR(
    toBase64(op.func),
    'base64'
  )
  const invoke = readField(hostFunction, 'invokeContract')
  return {
    contract: RealSdk.Address.fromScAddress(
      readField(invoke, 'contractAddress') as RealSdk.xdr.ScAddress
    ).toString(),
    fnName: String(readField(invoke, 'functionName')),
    args: (readField(invoke, 'args') as RealSdk.xdr.ScVal[]).map((arg) =>
      RealSdk.scValToNative(arg)
    ),
  }
}

function describeTransaction(envelope: string) {
  const tx = parseTransaction(envelope)
  return jsonSafe({
    hash: hex(tx.hash()),
    source: tx.source,
    sequence: tx.sequence,
    fee: tx.fee,
    timeBounds: tx.timeBounds ?? null,
    memoType: tx.memo.type,
    // SDK 17 decodes a text memo read from XDR as raw bytes (SDK 14 gave a
    // string). The app never reads a decoded memo; compare the text.
    memoValue:
      tx.memo.value === null || tx.memo.value === undefined
        ? null
        : tx.memo.value instanceof Uint8Array
          ? new TextDecoder().decode(tx.memo.value)
          : String(tx.memo.value),
    operations: tx.operations.map((op) =>
      op.type === 'invokeHostFunction'
        ? { type: op.type, invocation: decodeInvocation(envelope) }
        : op
    ),
  })
}

function expectationsFor(
  decoded: ReturnType<typeof decodeInvocation>
): TipInvocationExpectations {
  const { fnName, args } = decoded
  if (fnName === 'tip_article') {
    return {
      contractId: decoded.contract,
      allowedFunctions: [fnName],
      expectedFunction: fnName,
      articleId: args[1] as string,
      authorAddress: args[2] as string,
      minStroops: args[3] as bigint,
      exactStroops: args[3] as bigint,
    }
  }
  if (fnName === 'tip_highlight_direct') {
    return {
      contractId: decoded.contract,
      allowedFunctions: [fnName],
      expectedFunction: fnName,
      highlightId: args[1] as string,
      articleId: args[2] as string,
      authorAddress: args[3] as string,
      minStroops: args[4] as bigint,
      exactStroops: args[4] as bigint,
    }
  }
  const tips = args[1] as Array<{
    article_id: string
    author: string
    amount: bigint
    highlight_id?: string
  }>
  return {
    contractId: decoded.contract,
    allowedFunctions: [fnName],
    expectedFunction: fnName,
    authorAddress: tips[0]!.author,
    minStroops: BigInt(1),
    batchTips: tips.map((tip) => ({
      articleId: tip.article_id,
      authorAddress: tip.author,
      highlightId: tip.highlight_id,
      minStroops: tip.amount,
      exactStroops: tip.amount,
    })),
  }
}

async function verifyCases(record: TestnetTransaction): Promise<VerifyCases> {
  const { verifyTipTransaction } = await import('../../convex/lib/horizon')
  const decoded = decodeInvocation(record.envelope_xdr)
  const base = expectationsFor(decoded)
  const tx = parseTransaction(record.envelope_xdr)

  const run = (
    invocation: TipInvocationExpectations,
    body: Partial<TestnetTransaction> = {},
    expectedSource = record.source_account
  ) =>
    verifyTipTransaction(
      async () => ({
        status: 200,
        ok: true,
        json: async () => ({ ...record, ...body }),
      }),
      {
        txId: record.hash,
        expectedSource,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        invocation,
      }
    ).then(jsonSafe)

  const feeBump = toBase64(
    RealSdk.TransactionBuilder.buildFeeBumpTransaction(
      feeSource,
      '1000000',
      tx,
      RealSdk.Networks.TESTNET
    )
  )
  const batch = base.batchTips
  const tamperFirstTip = (
    change: Partial<NonNullable<TipInvocationExpectations['batchTips']>[0]>
  ): TipInvocationExpectations => ({
    ...base,
    batchTips: [{ ...batch![0]!, ...change }, ...batch!.slice(1)],
  })

  return {
    decoded: jsonSafe(decoded),
    transaction: describeTransaction(record.envelope_xdr),
    match: await run(base),
    timeBoundsMatch: await run({
      ...base,
      expectedTimeBounds: {
        minTime: String(tx.timeBounds?.minTime ?? '0'),
        maxTime: String(tx.timeBounds?.maxTime ?? '0'),
      },
    }),
    timeBoundsMismatch: await run({
      ...base,
      expectedTimeBounds: { minTime: '1', maxTime: '2' },
    }),
    wrongContract: await run({ ...base, contractId: NFT_CONTRACT_ID }),
    wrongFunction: await run({
      ...base,
      allowedFunctions: ['tip_article_with_arweave'],
      expectedFunction: 'tip_article_with_arweave',
    }),
    wrongAuthor: await run(
      batch
        ? tamperFirstTip({ authorAddress: secondAuthor.publicKey() })
        : { ...base, authorAddress: secondAuthor.publicKey() }
    ),
    wrongAmount: await run(
      batch
        ? tamperFirstTip({ exactStroops: BigInt(1) })
        : { ...base, exactStroops: BigInt(1) }
    ),
    wrongArticle: await run(
      batch
        ? tamperFirstTip({ articleId: 'zzzzzzzzzz' })
        : { ...base, articleId: 'zzzzzzzzzz' }
    ),
    wrongTipper: await run(
      base,
      { source_account: tipper.publicKey() },
      tipper.publicKey()
    ),
    wrongSource: await run(base, {}, tipper.publicKey()),
    feeBumpWrapped: await run(base, { envelope_xdr: feeBump }),
    malformedEnvelope: await run(base, { envelope_xdr: 'not-xdr' }),
    truncatedEnvelope: await run(base, {
      envelope_xdr: record.envelope_xdr.slice(0, 40),
    }),
  }
}

async function buildObservations(): Promise<Observations> {
  vi.stubEnv('NEXT_PUBLIC_STELLAR_NETWORK', 'TESTNET')

  const practice = await import('../../lib/stellar/practice')

  const practiceTx = practice.buildPractice(
    new RealSdk.Account(tipper.publicKey(), SEQUENCE)
  )
  const practiceSigned = parseTransaction(toBase64(practiceTx))
  practiceSigned.sign(tipper)
  const practiceValid = practice.validateSigned(
    toBase64(practiceSigned),
    practiceTx
  )
  const rejection = (fn: () => unknown) => {
    try {
      fn()
      return 'accepted'
    } catch (error) {
      return (error as Error).message
    }
  }

  const verification: Record<string, VerifyCases> = {}
  for (const record of testnet.transactions) {
    verification[record.function] = await verifyCases(record)
  }

  return jsonSafe({
    build: {
      practice: {
        xdr: toBase64(practiceTx),
        tx: describeTransaction(toBase64(practiceTx)),
      },
    },
    practice: {
      validHash: hex(practiceValid.hash()),
      unsigned: rejection(() =>
        practice.validateSigned(toBase64(practiceTx), practiceTx)
      ),
      otherTransaction: rejection(() =>
        practice.validateSigned(
          toBase64(practiceSigned),
          practice.buildPractice(new RealSdk.Account(tipper.publicKey(), '1'))
        )
      ),
    },
    verification,
  }) as Observations
}

describe('Stellar SDK encode and decode parity', () => {
  let observed: Observations

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: FIXED_NOW_MS })
    observed = await buildObservations()
    if (RECORD) {
      writeFileSync(BASELINE_PATH, `${JSON.stringify(observed, null, 2)}\n`)
    }
  })

  afterAll(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  const baseline = (): Observations =>
    JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Observations

  it('builds the practice transaction as recorded', () => {
    const build = (o: Observations) =>
      (o.build as Record<string, unknown>).practice
    expect(build(observed)).toEqual(build(baseline()))
  })

  it('validates practice signatures as recorded', () => {
    expect(observed.practice).toEqual(baseline().practice)
  })

  it.each(testnet.transactions.map((record) => record.function))(
    'verifies the %s testnet transaction as recorded',
    (fn) => {
      const recorded = (baseline().verification as Record<string, unknown>)[fn]
      expect((observed.verification as Record<string, unknown>)[fn]).toEqual(
        recorded
      )
    }
  )

  it('accepts every real testnet tip with its exact on-chain amount', () => {
    for (const record of testnet.transactions) {
      const cases = (observed.verification as Record<string, VerifyCases>)[
        record.function
      ]!
      expect(cases.match).toMatchObject({ ok: true, ledger: record.ledger })
      expect(cases.feeBumpWrapped).toMatchObject({ ok: true })
      expect(cases.wrongAmount).toMatchObject({ reason: 'amount_mismatch' })
      expect(cases.wrongAuthor).toMatchObject({ reason: 'author_mismatch' })
    }
  })
})
