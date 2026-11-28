/**
 * Fabricated chain fixtures for the v2 chain layer tests.
 *
 * The Core contract is not deployed yet, so `Tipped` events are built here
 * from the event definition in docs/architecture/v2/02-core-contract.md,
 * section 2.4 (topics: `tipped`, `article_id`, `author`; data: a map keyed by
 * field name). Replace them with fixtures recorded from the local network once
 * the contracts exist. `fixtures/testnet-other-contract-success.json` is a
 * real, read-only testnet response.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Keypair, StrKey, nativeToScVal, xdr } from '@stellar/stellar-sdk'
import { hexToBytes } from '../../convex/lib/chain/ids'

export const CORE = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const contractAddress = (fill: number) =>
  StrKey.encodeContract(new Uint8Array(32).fill(fill))
export const OTHER_CONTRACT = contractAddress(21)
export const TOKEN = contractAddress(22)
export const OTHER_TOKEN = contractAddress(23)

/** Deterministic throwaway keys; they never sign anything. */
export function seedAddress(fill: number): string {
  return Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(fill)).publicKey()
}
export const TIPPER = seedAddress(11)
export const AUTHOR = seedAddress(12)
export const OTHER_AUTHOR = seedAddress(13)

export type TippedFixture = {
  contractId?: string
  name?: string
  articleId: string
  author: string
  tipper: string
  token: string
  gross: bigint
  fee?: bigint
  highlightId?: string | null
  contentHash?: string
  contentVersion?: number
  clientRef: string
  totalAfter?: bigint
  splitCount?: number
  /** Event type; a real `Tipped` event is always a contract event. */
  eventType?: 'contract' | 'system' | 'diagnostic'
}

export function feeOf(gross: bigint): bigint {
  return (gross * BigInt(250)) / BigInt(10_000)
}

/** Base64 `ContractEvent` XDR for a `Tipped` event. */
export function tippedEventXdr(f: TippedFixture): string {
  const fee = f.fee ?? feeOf(f.gross)
  const data = xdr.ScVal.scvMap(
    [
      ['client_ref', nativeToScVal(hexToBytes(f.clientRef))],
      [
        'content_hash',
        nativeToScVal(hexToBytes(f.contentHash ?? 'ab'.repeat(32))),
      ],
      [
        'content_version',
        nativeToScVal(f.contentVersion ?? 1, { type: 'u32' }),
      ],
      ['fee', nativeToScVal(fee, { type: 'i128' })],
      ['gross', nativeToScVal(f.gross, { type: 'i128' })],
      [
        'highlight_id',
        f.highlightId
          ? nativeToScVal(hexToBytes(f.highlightId))
          : xdr.ScVal.scvVoid(),
      ],
      ['net', nativeToScVal(f.gross - fee, { type: 'i128' })],
      ['split_count', nativeToScVal(f.splitCount ?? 0, { type: 'u32' })],
      ['tipper', nativeToScVal(f.tipper, { type: 'address' })],
      ['token', nativeToScVal(f.token, { type: 'address' })],
      ['total_after', nativeToScVal(f.totalAfter ?? f.gross, { type: 'i128' })],
    ].map(
      ([key, val]) =>
        new xdr.ScMapEntry({
          key: nativeToScVal(key as string, { type: 'symbol' }),
          val: val as xdr.ScVal,
        })
    )
  )
  const event = new xdr.ContractEvent({
    ext: xdr.ExtensionPoint.v0(),
    contractId: new xdr.ContractId(StrKey.decodeContract(f.contractId ?? CORE)),
    type: xdr.ContractEventType[f.eventType ?? 'contract'],
    body: xdr.ContractEventBody.v0(
      new xdr.ContractEventV0({
        topics: [
          nativeToScVal(f.name ?? 'tipped', { type: 'symbol' }),
          nativeToScVal(hexToBytes(f.articleId)),
          nativeToScVal(f.author, { type: 'address' }),
        ],
        data,
      })
    ),
  })
  return event.toXdr('base64')
}

const WINDOW = {
  latestLedger: 6_000_100,
  latestLedgerCloseTime: '1795700000',
  oldestLedger: 5_879_140,
  oldestLedgerCloseTime: '1795095000',
}

export function successResponse(
  hash: string,
  contractEventsXdr: string[][],
  ledger = 6_000_000
) {
  return {
    ...WINDOW,
    status: 'SUCCESS',
    txHash: hash,
    applicationOrder: 1,
    feeBump: false,
    envelopeXdr: 'AAAA',
    resultXdr: 'AAAA',
    resultMetaXdr: 'AAAA',
    events: { transactionEventsXdr: [], contractEventsXdr },
    ledger,
    createdAt: '1795690000',
  }
}

export function failedResponse(hash: string, ledger = 6_000_000) {
  return {
    ...successResponse(hash, [[]], ledger),
    status: 'FAILED',
  }
}

export function notFoundResponse(hash: string) {
  return {
    ...WINDOW,
    status: 'NOT_FOUND',
    txHash: hash,
    applicationOrder: 0,
    feeBump: false,
    events: {},
    ledger: 0,
    createdAt: '0',
  }
}

export function realOtherContractSuccess(hash: string) {
  const fixture = JSON.parse(
    readFileSync(
      join(__dirname, 'fixtures', 'testnet-other-contract-success.json'),
      'utf8'
    )
  ) as { response: { result: Record<string, unknown> } }
  return { ...fixture.response.result, txHash: hash }
}

type Responder = (
  method: string,
  params: Record<string, unknown> | undefined
) => unknown | Promise<unknown>

/**
 * A fake JSON-RPC `fetch`. The responder returns a `result` object, an
 * `{ error }` object, or a `Response`-like object for HTTP-level failures.
 */
export function fakeRpcFetch(responder: Responder) {
  const calls: Array<{ method: string; params: unknown }> = []
  const fn = async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? '{}') as {
      id: number
      method: string
      params?: Record<string, unknown>
    }
    calls.push({ method: body.method, params: body.params })
    const out = await responder(body.method, body.params)
    if (out && typeof out === 'object' && 'httpStatus' in out) {
      const status = (out as { httpStatus: number }).httpStatus
      return { ok: false, status, json: async () => ({}) }
    }
    if (out instanceof Error) throw out
    const payload =
      out &&
      typeof out === 'object' &&
      'error' in out &&
      Object.keys(out).length === 1
        ? {
            jsonrpc: '2.0',
            id: body.id,
            error: (out as { error: unknown }).error,
          }
        : { jsonrpc: '2.0', id: body.id, result: out }
    return { ok: true, status: 200, json: async () => payload }
  }
  return Object.assign(fn, { calls })
}
