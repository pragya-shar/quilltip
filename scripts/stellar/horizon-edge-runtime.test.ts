// @vitest-environment edge-runtime
/**
 * Runs the Horizon tip verifier in an edge (V8 isolate) environment, the
 * closest local match to the Convex default runtime that imports it.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { verifyTipTransaction } from '../../convex/lib/horizon'

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
