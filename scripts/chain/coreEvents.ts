/**
 * Core contract events for indexer tests, taken from the Core contract's own
 * test snapshots (contracts/core/test_snapshots), which hold the events the
 * contract emitted, as JSON XDR. `content_updated` and `splits_set` do not
 * appear in a snapshot's last call, so they are built in the same JSON shape
 * from contracts/core/src/events.rs.
 *
 * `coreRpcEvent` turns one into the `getEvents` form (base64 `ScVal` topics
 * and value) with a chosen ledger and RPC id.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { xdr } from '@stellar/stellar-sdk'
import type { RawRpcEvent } from '../../convex/lib/chain/rpc'

const SNAPSHOT_ROOT = join(
  __dirname,
  '../../contracts/core/test_snapshots/test'
)

/** The Core contract address used in the snapshots. */
export const SNAPSHOT_CORE =
  'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOLZM'
/** The token (SAC) address used in the snapshots. */
export const SNAPSHOT_TOKEN =
  'CAJS4RVGLFL2ANWW7W6Q4RGOZQXSVXW5BQKJ7A3ISE4EOUM5HHO77CQL'

type JsonEvent = {
  ext: string
  contract_id: string
  type: string
  body: { v0: { topics: Array<Record<string, unknown>>; data: unknown } }
}

let cache: Map<string, JsonEvent> | null = null

function snapshotEvents(): Map<string, JsonEvent> {
  if (cache) return cache
  cache = new Map()
  for (const dir of readdirSync(SNAPSHOT_ROOT)) {
    for (const file of readdirSync(join(SNAPSHOT_ROOT, dir))) {
      const snapshot = JSON.parse(
        readFileSync(join(SNAPSHOT_ROOT, dir, file), 'utf8')
      ) as { events?: Array<{ event: JsonEvent }> }
      for (const { event } of snapshot.events ?? []) {
        const name = event.body.v0.topics[0]?.symbol
        if (
          typeof name === 'string' &&
          event.contract_id === SNAPSHOT_CORE &&
          !cache.has(name)
        ) {
          cache.set(name, event)
        }
      }
    }
  }
  return cache
}

const ADDRESS_A = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAARQG5'

function built(
  name: string,
  articleId: string,
  entries: Array<[string, unknown]>
): JsonEvent {
  return {
    ext: 'v0',
    contract_id: SNAPSHOT_CORE,
    type: 'contract',
    body: {
      v0: {
        topics: [{ symbol: name }, { bytes: articleId }],
        data: {
          map: entries
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([key, val]) => ({ key: { symbol: key }, val })),
        },
      },
    },
  }
}

const BUILT: Record<string, () => JsonEvent> = {
  content_updated: () =>
    built('content_updated', 'ab'.repeat(32), [
      ['content_hash', { bytes: 'cd'.repeat(32) }],
      ['arweave_id', 'void'],
      ['content_version', { u32: 2 }],
    ]),
  splits_set: () =>
    built('splits_set', 'ab'.repeat(32), [
      [
        'splits',
        {
          vec: [
            {
              map: [
                { key: { symbol: 'bps' }, val: { u32: 6000 } },
                { key: { symbol: 'recipient' }, val: { address: ADDRESS_A } },
              ],
            },
          ],
        },
      ],
    ]),
}

/** A Core event in JSON XDR form, ready to edit. */
export function coreEventJson(name: string): JsonEvent {
  const source = snapshotEvents().get(name) ?? BUILT[name]?.()
  if (!source) throw new Error(`No Core event fixture named ${name}`)
  return JSON.parse(JSON.stringify(source)) as JsonEvent
}

/** Sets a field in the event's data map. */
export function setData(event: JsonEvent, key: string, val: unknown): void {
  const data = event.body.v0.data as {
    map: Array<{ key: { symbol: string }; val: unknown }>
  }
  const entry = data.map.find((e) => e.key.symbol === key)
  if (!entry) throw new Error(`No data field ${key}`)
  entry.val = val
}

/** Sets topic `index` (0 is the event name). */
export function setTopic(event: JsonEvent, index: number, val: unknown): void {
  event.body.v0.topics[index] = val as Record<string, unknown>
}

/** RPC event id: TOID of (ledger, transaction, operation) and the event index. */
export function rpcEventId(
  ledger: number,
  tx: number,
  op: number,
  index: number
): string {
  const toid =
    (BigInt(ledger) << BigInt(32)) | (BigInt(tx) << BigInt(12)) | BigInt(op)
  return `${toid.toString().padStart(19, '0')}-${String(index).padStart(10, '0')}`
}

export function coreRpcEvent(
  event: JsonEvent,
  options: {
    ledger: number
    tx?: number
    index?: number
    txHash?: string
    contractId?: string
    closeTime?: number
    inSuccessfulContractCall?: boolean
  }
): RawRpcEvent {
  const parsed = xdr.ContractEvent.fromJson(
    event as unknown as Parameters<typeof xdr.ContractEvent.fromJson>[0]
  )
  if (parsed.body.type !== 'v0') throw new Error('unexpected event body')
  const tx = options.tx ?? 1
  return {
    type: 'contract',
    ledger: options.ledger,
    ledgerClosedAt: new Date(
      (options.closeTime ?? 1_795_000_000 + options.ledger * 5) * 1000
    ).toISOString(),
    contractId: options.contractId ?? SNAPSHOT_CORE,
    id: rpcEventId(options.ledger, tx, 0, options.index ?? 0),
    operationIndex: 0,
    transactionIndex: tx,
    txHash:
      options.txHash ??
      `${options.ledger.toString(16).padStart(8, '0')}`.repeat(8),
    topic: parsed.body.v0.topics.map((t) => t.toXdr('base64')),
    value: parsed.body.v0.data.toXdr('base64'),
    inSuccessfulContractCall: options.inSuccessfulContractCall ?? true,
  }
}
