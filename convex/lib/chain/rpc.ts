/**
 * Typed Stellar RPC client for the Convex default runtime
 * (docs/architecture/v2/06-app-integration.md, section 6.3).
 *
 * JSON-RPC over an injected `fetch`, so tests run without network access and
 * the caller owns retries. Endpoint selection goes through the network guard:
 * use `createBackendRpcClient()` in server code.
 */
import { backendRpcUrl } from './env'

export type RpcFetch = (
  input: string,
  init: {
    method: 'POST'
    headers: Record<string, string>
    body: string
    signal?: AbortSignal
  }
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

/** `transient`: retry later. `permanent`: the response is unusable. */
export type RpcErrorKind = 'transient' | 'permanent'

export class RpcError extends Error {
  constructor(
    readonly kind: RpcErrorKind,
    message: string,
    readonly code?: number
  ) {
    super(message)
    this.name = 'RpcError'
  }
}

export type LedgerWindow = {
  latestLedger: number
  /** Unix seconds. */
  latestLedgerCloseTime: number
  oldestLedger: number
  /** Unix seconds. */
  oldestLedgerCloseTime: number
}

export type GetTransactionResult = LedgerWindow & {
  status: 'SUCCESS' | 'FAILED' | 'NOT_FOUND'
  txHash: string
  /** Set when the transaction is in a ledger. */
  ledger: number | null
  /** Unix seconds; set when the transaction is in a ledger. */
  createdAt: number | null
  applicationOrder: number | null
  feeBump: boolean
  /** Base64 `ContractEvent` XDR, one list per operation. */
  contractEventsXdr: string[][]
  resultXdr: string | null
}

export type RawRpcEvent = {
  type: string
  ledger: number
  ledgerClosedAt: string
  contractId: string
  id: string
  operationIndex?: number
  transactionIndex?: number
  txHash: string
  /** Base64 `ScVal` XDR. */
  topic: string[]
  /** Base64 `ScVal` XDR. */
  value: string
  inSuccessfulContractCall?: boolean
}

export type GetEventsParams = {
  startLedger?: number
  endLedger?: number
  filters: Array<{
    type?: 'contract' | 'system'
    contractIds?: string[]
    topics?: string[][]
  }>
  pagination?: { cursor?: string; limit?: number }
}

export type GetEventsResult = LedgerWindow & {
  events: RawRpcEvent[]
  cursor: string
}

export type GetHealthResult = LedgerWindow & {
  status: string
  ledgerRetentionWindow: number
}

export type GetLatestLedgerResult = {
  id: string
  sequence: number
  protocolVersion: number
}

export type SimulateTransactionResult = {
  latestLedger: number
  error: string | null
  /** Base64 `ScVal` XDR of the return value, when simulation succeeded. */
  retvalXdr: string | null
  minResourceFee: string | null
}

export type RpcClient = {
  getTransaction(hash: string): Promise<GetTransactionResult>
  getEvents(params: GetEventsParams): Promise<GetEventsResult>
  getLatestLedger(): Promise<GetLatestLedgerResult>
  getHealth(): Promise<GetHealthResult>
  /** For read-only views. `transactionXdr` is an unsigned envelope. */
  simulateTransaction(
    transactionXdr: string
  ): Promise<SimulateTransactionResult>
}

export const RPC_TIMEOUT_MS = 10_000

const TRANSACTION_HASH = /^[0-9a-f]{64}$/

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new RpcError('permanent', 'RPC result is not an object')
  }
  return value as Record<string, unknown>
}

function int(value: unknown, field: string): number {
  const n = typeof value === 'string' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) {
    throw new RpcError('permanent', `RPC field ${field} is not an integer`)
  }
  return n
}

function optionalInt(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : int(value, field)
}

function ledgerWindow(r: Record<string, unknown>): LedgerWindow {
  return {
    latestLedger: int(r.latestLedger, 'latestLedger'),
    latestLedgerCloseTime: int(
      r.latestLedgerCloseTime ?? 0,
      'latestLedgerCloseTime'
    ),
    oldestLedger: int(r.oldestLedger ?? 0, 'oldestLedger'),
    oldestLedgerCloseTime: int(
      r.oldestLedgerCloseTime ?? 0,
      'oldestLedgerCloseTime'
    ),
  }
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) {
    throw new RpcError('permanent', `RPC field ${field} is not a string list`)
  }
  return value as string[]
}

export function parseGetTransaction(
  hash: string,
  value: unknown
): GetTransactionResult {
  const r = record(value)
  const status = r.status
  if (status !== 'SUCCESS' && status !== 'FAILED' && status !== 'NOT_FOUND') {
    throw new RpcError('permanent', `Unknown transaction status ${status}`)
  }
  const events =
    r.events === undefined ? {} : (record(r.events) as Record<string, unknown>)
  const contractEventsXdr =
    events.contractEventsXdr === undefined
      ? []
      : (() => {
          if (!Array.isArray(events.contractEventsXdr)) {
            throw new RpcError('permanent', 'contractEventsXdr is not a list')
          }
          return events.contractEventsXdr.map((op, i) =>
            stringList(op, `contractEventsXdr[${i}]`)
          )
        })()
  const found = status !== 'NOT_FOUND'
  return {
    ...ledgerWindow(r),
    status,
    txHash: typeof r.txHash === 'string' ? r.txHash : hash,
    ledger: found ? int(r.ledger, 'ledger') : null,
    createdAt: found ? int(r.createdAt, 'createdAt') : null,
    applicationOrder: found
      ? optionalInt(r.applicationOrder, 'applicationOrder')
      : null,
    feeBump: r.feeBump === true,
    contractEventsXdr,
    resultXdr: typeof r.resultXdr === 'string' ? r.resultXdr : null,
  }
}

export function createRpcClient(options: {
  url: string
  fetch: RpcFetch
  timeoutMs?: number
}): RpcClient {
  let id = 0

  async function call(method: string, params?: unknown): Promise<unknown> {
    const controller =
      typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller
      ? setTimeout(
          () => controller.abort(),
          options.timeoutMs ?? RPC_TIMEOUT_MS
        )
      : null
    let response: Awaited<ReturnType<RpcFetch>>
    try {
      response = await options.fetch(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++id,
          method,
          ...(params === undefined ? {} : { params }),
        }),
        ...(controller ? { signal: controller.signal } : {}),
      })
    } catch (error) {
      throw new RpcError(
        'transient',
        `RPC ${method} request failed: ${error instanceof Error ? error.message : String(error)}`
      )
    } finally {
      if (timer) clearTimeout(timer)
    }
    if (
      response.status === 408 ||
      response.status === 429 ||
      response.status >= 500
    ) {
      throw new RpcError(
        'transient',
        `RPC ${method} returned HTTP ${response.status}`,
        response.status
      )
    }
    if (!response.ok) {
      throw new RpcError(
        'permanent',
        `RPC ${method} returned HTTP ${response.status}`,
        response.status
      )
    }
    let body: Record<string, unknown>
    try {
      body = record(await response.json())
    } catch {
      throw new RpcError('transient', `RPC ${method} returned invalid JSON`)
    }
    if (body.error !== undefined) {
      const error = record(body.error)
      const code = typeof error.code === 'number' ? error.code : undefined
      // -32603 internal error and -32000 server errors are worth a retry.
      const transient = code === -32603 || code === -32000
      throw new RpcError(
        transient ? 'transient' : 'permanent',
        `RPC ${method} error: ${String(error.message ?? 'unknown')}`,
        code
      )
    }
    return body.result
  }

  return {
    async getTransaction(hash) {
      const normalized = hash.toLowerCase()
      if (!TRANSACTION_HASH.test(normalized)) {
        throw new RpcError('permanent', 'Invalid transaction hash')
      }
      return parseGetTransaction(
        normalized,
        await call('getTransaction', { hash: normalized })
      )
    },
    async getEvents(params) {
      const r = record(await call('getEvents', params))
      if (!Array.isArray(r.events)) {
        throw new RpcError('permanent', 'getEvents events is not a list')
      }
      return {
        ...ledgerWindow(r),
        events: r.events as RawRpcEvent[],
        cursor: typeof r.cursor === 'string' ? r.cursor : '',
      }
    },
    async getLatestLedger() {
      const r = record(await call('getLatestLedger'))
      return {
        id: String(r.id ?? ''),
        sequence: int(r.sequence, 'sequence'),
        protocolVersion: int(r.protocolVersion ?? 0, 'protocolVersion'),
      }
    },
    async getHealth() {
      const r = record(await call('getHealth'))
      return {
        ...ledgerWindow(r),
        status: String(r.status ?? ''),
        ledgerRetentionWindow: int(
          r.ledgerRetentionWindow ?? 0,
          'ledgerRetentionWindow'
        ),
      }
    },
    async simulateTransaction(transactionXdr) {
      const r = record(
        await call('simulateTransaction', { transaction: transactionXdr })
      )
      const results = Array.isArray(r.results) ? r.results : []
      const first = results[0] ? record(results[0]) : null
      return {
        latestLedger: int(r.latestLedger ?? 0, 'latestLedger'),
        error: typeof r.error === 'string' ? r.error : null,
        retvalXdr: first && typeof first.xdr === 'string' ? first.xdr : null,
        minResourceFee:
          typeof r.minResourceFee === 'string' ? r.minResourceFee : null,
      }
    },
  }
}

/** RPC client for server code: the URL comes from the network guard. */
export function createBackendRpcClient(
  fetchImpl: RpcFetch = fetch as unknown as RpcFetch,
  env: Record<string, string | undefined> = process.env
): RpcClient {
  return createRpcClient({ url: backendRpcUrl(env), fetch: fetchImpl })
}
