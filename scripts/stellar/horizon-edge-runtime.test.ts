// @vitest-environment edge-runtime
/**
 * Runs the Horizon tip verifier in an edge (V8 isolate) environment, the
 * closest local match to the Convex default runtime that imports it.
 *
 * The setup import must stay first: it restores the native Uint8Array
 * constructor before the Stellar SDK loads (see the setup file for why).
 */
import '../lib/edge-runtime-uint8array'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, it } from 'vitest'

type TestnetTransaction = {
  hash: string
  function: string
  source_account: string
  ledger: number
  envelope_xdr: string
}

const { transactions } = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'testnet-transactions.json'), 'utf8')
) as { transactions: TestnetTransaction[] }

const baseline = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'sdk-baseline.json'), 'utf8')
) as {
  verification: Record<
    string,
    { decoded: { contract: string; args: unknown[] }; match: unknown }
  >
}

function fromJsonSafe(value: unknown): bigint {
  return BigInt(String(value).replace(/n$/, ''))
}

// The Convex default runtime has no Buffer global. Remove it before the
// verifier and the SDK load, so a Buffer dependency fails here.
const globals = globalThis as { Buffer?: unknown }
const savedBuffer = globals.Buffer
let verifyTipTransaction: typeof import('../../convex/lib/horizon').verifyTipTransaction

beforeAll(async () => {
  delete globals.Buffer
  ;({ verifyTipTransaction } = await import('../../convex/lib/horizon'))
})

afterAll(() => {
  globals.Buffer = savedBuffer
})

it('loads the verifier without the Buffer global', () => {
  expect(globals.Buffer).toBeUndefined()
  expect(typeof verifyTipTransaction).toBe('function')
})

it.each(transactions.map((record) => [record.function, record] as const))(
  'verifies the %s testnet transaction in the edge runtime',
  async (fn, record) => {
    const recorded = baseline.verification[fn]!
    const args = recorded.decoded.args
    const single = fn === 'tip_article' || fn === 'tip_highlight_direct'
    const amount = single ? fromJsonSafe(args[args.length - 1]) : BigInt(1)
    const author = single
      ? (args[args.length - 2] as string)
      : (args[1] as Array<{ author: string }>)[0]!.author

    const result = await verifyTipTransaction(
      async () => ({ status: 200, ok: true, json: async () => record }),
      {
        txId: record.hash,
        expectedSource: record.source_account,
        horizonUrl: 'https://horizon-testnet.stellar.org',
        invocation: {
          contractId: recorded.decoded.contract,
          allowedFunctions: [fn],
          authorAddress: author,
          minStroops: amount,
        },
      }
    )

    expect(result).toMatchObject({ ok: true, ledger: record.ledger })
  }
)
