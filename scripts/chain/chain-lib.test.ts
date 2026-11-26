import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  articleIdHex,
  highlightIdHex,
  isHexOfLength,
  newClientRefHex,
} from '../../convex/lib/chain/ids'
import {
  EventDecodeError,
  decodeContractEventXdr,
  parseTippedEvent,
} from '../../convex/lib/chain/events'
import { RpcError, createRpcClient } from '../../convex/lib/chain/rpc'
import { backendRpcUrl, readChainEnv } from '../../convex/lib/chain/env'
import {
  aggregateVerification,
  tipFee,
  verifyTippedTransaction,
  type ExpectedTip,
} from '../../convex/lib/chain/verify'
import {
  AUTHOR,
  CORE,
  OTHER_AUTHOR,
  OTHER_CONTRACT,
  OTHER_TOKEN,
  TIPPER,
  TOKEN,
  fakeRpcFetch,
  failedResponse,
  notFoundResponse,
  realOtherContractSuccess,
  seedAddress,
  successResponse,
  tippedEventXdr,
} from './fixtures'

const vectors = JSON.parse(
  readFileSync(
    join(__dirname, '../../contracts/shared/test-vectors.json'),
    'utf8'
  )
) as {
  identifiers: {
    article_ids: Array<{ article_id: string; convex_id: string }>
    highlight_ids: Array<{
      highlight_id: string
      source: string
      v1_convex_id: string
    }>
  }
}

const HASH = 'a'.repeat(64)
const ARTICLE =
  '817a22030ab3bde847ecd28ec9de23f416a043ed1a720d48a9fbeba662a4a9ba'
const HIGHLIGHT =
  'e3551930d1b1612eda907c05db04be6588619981e505e04e465885aef7480584'
const REF = '0123456789abcdef0123456789abcdef'

function expected(overrides: Partial<ExpectedTip> = {}): ExpectedTip {
  return {
    key: 'row1',
    clientRef: REF,
    articleKey: ARTICLE,
    tipper: TIPPER,
    token: TOKEN,
    gross: '1000000',
    highlightKey: null,
    author: AUTHOR,
    ...overrides,
  }
}

function event(overrides: Parameters<typeof tippedEventXdr>[0] | object = {}) {
  return tippedEventXdr({
    articleId: ARTICLE,
    author: AUTHOR,
    tipper: TIPPER,
    token: TOKEN,
    gross: BigInt(1_000_000),
    clientRef: REF,
    ...overrides,
  })
}

describe('identifiers match the shared test vectors', () => {
  it.each(vectors.identifiers.article_ids)(
    'article_id for $convex_id',
    async ({ convex_id, article_id }) => {
      expect(await articleIdHex(convex_id)).toBe(article_id)
    }
  )

  it.each(vectors.identifiers.highlight_ids)(
    'highlight_id for $source',
    async ({ source, highlight_id, v1_convex_id }) => {
      const digest = await highlightIdHex(source)
      expect(digest).toBe(highlight_id)
      expect(digest.slice(0, 28)).toBe(v1_convex_id)
    }
  )

  it('client_ref is 16 random bytes in hex', () => {
    const a = newClientRefHex()
    const b = newClientRefHex()
    expect(isHexOfLength(a, 16)).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('Tipped event decoding', () => {
  it('decodes every field of a Tipped event', () => {
    const decoded = decodeContractEventXdr(
      event({ highlightId: HIGHLIGHT, splitCount: 2, contentVersion: 3 })
    )
    expect(decoded.contractId).toBe(CORE)
    expect(decoded.name).toBe('tipped')
    expect(parseTippedEvent(decoded)).toEqual({
      articleId: ARTICLE,
      author: AUTHOR,
      tipper: TIPPER,
      token: TOKEN,
      gross: BigInt(1_000_000),
      fee: BigInt(25_000),
      net: BigInt(975_000),
      highlightId: HIGHLIGHT,
      contentHash: 'ab'.repeat(32),
      contentVersion: 3,
      clientRef: REF,
      totalAfter: BigInt(1_000_000),
      splitCount: 2,
    })
  })

  it('returns null for other event names and rejects malformed Tipped data', () => {
    expect(
      parseTippedEvent(decodeContractEventXdr(event({ name: 'token_set' })))
    ).toBeNull()
    expect(() =>
      parseTippedEvent({
        contractId: CORE,
        name: 'tipped',
        topics: ['tipped', new Uint8Array(32), AUTHOR],
        data: { tipper: 'not-an-address' },
      })
    ).toThrow(EventDecodeError)
    expect(() => decodeContractEventXdr('not-xdr')).toThrow(EventDecodeError)
  })

  it('decodes a real testnet event of another contract', () => {
    const real = realOtherContractSuccess(HASH) as {
      events: { contractEventsXdr: string[][] }
    }
    const decoded = decodeContractEventXdr(
      real.events.contractEventsXdr[0]![0]!
    )
    expect(decoded.contractId).toMatch(/^C[A-Z2-7]{55}$/)
    expect(parseTippedEvent(decoded)).toBeNull()
  })
})

describe('verifier (section 6.4)', () => {
  const verify = (events: string[][], exp = [expected()], ledger = 100) =>
    verifyTippedTransaction({
      expected: exp,
      coreContractId: CORE,
      contractEventsXdr: events,
      ledger,
      createdLedger: 50,
    })

  it('confirms a matching event and computes the fee from gross', () => {
    const [outcome] = verify([[event()]])
    expect(outcome).toMatchObject({ status: 'CONFIRMED', needsReview: false })
    expect(tipFee(BigInt(1_000_000))).toBe(BigInt(25_000))
    expect(tipFee(BigInt(39))).toBe(BigInt(0))
  })

  it.each([
    ['article_id', { articleId: 'cd'.repeat(32) }],
    ['tipper', { tipper: seedAddress(99) }],
    ['token', { token: OTHER_TOKEN }],
    ['gross', { gross: BigInt(999_999) }],
    ['highlight_id', { highlightId: HIGHLIGHT }],
    ['fee', { fee: BigInt(1) }],
  ])('a different %s is MISMATCH field:%s with review', (field, change) => {
    const [outcome] = verify([[event(change)]])
    expect(outcome).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: `field:${field}`,
      needsReview: true,
    })
  })

  it('a different author is MISMATCH author without review', () => {
    const [outcome] = verify([[event({ author: OTHER_AUTHOR })]])
    expect(outcome).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'author',
      needsReview: false,
    })
    expect(outcome!.event?.author).toBe(OTHER_AUTHOR)
  })

  it('events from another contract, another function or none are no_event', () => {
    expect(verify([[event({ contractId: OTHER_CONTRACT })]])[0]).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'no_event',
      needsReview: true,
    })
    expect(verify([[event({ name: 'article_registered' })]])[0]).toMatchObject({
      mismatchReason: 'no_event',
    })
    expect(verify([])[0]).toMatchObject({ mismatchReason: 'no_event' })
    const real = realOtherContractSuccess(HASH) as {
      events: { contractEventsXdr: string[][] }
    }
    expect(verify(real.events.contractEventsXdr)[0]).toMatchObject({
      mismatchReason: 'no_event',
    })
  })

  it('a transaction older than the record is MISMATCH field:ledger', () => {
    expect(verify([[event()]], [expected()], 49)[0]).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'field:ledger',
    })
  })

  it('matches each batch event by client_ref and aggregates the batch', () => {
    const ref2 = 'f'.repeat(32)
    const outcomes = verify(
      [[event(), event({ clientRef: ref2, author: OTHER_AUTHOR })]],
      [
        expected(),
        expected({ key: 'row2', clientRef: ref2, author: OTHER_AUTHOR }),
      ]
    )
    expect(outcomes.map((o) => o.status)).toEqual(['CONFIRMED', 'CONFIRMED'])
    expect(aggregateVerification(outcomes)).toEqual({
      status: 'CONFIRMED',
      needsReview: false,
    })
    const mixed = verify(
      [[event(), event({ clientRef: ref2, gross: BigInt(5) })]],
      [expected(), expected({ key: 'row2', clientRef: ref2 })]
    )
    expect(aggregateVerification(mixed)).toEqual({
      status: 'MISMATCH',
      mismatchReason: 'field:gross',
      needsReview: true,
    })
  })

  it('two events with one client_ref are MISMATCH with review', () => {
    expect(verify([[event(), event()]])[0]).toMatchObject({
      status: 'MISMATCH',
      mismatchReason: 'field:client_ref',
      needsReview: true,
    })
  })
})

describe('RPC client', () => {
  it('parses SUCCESS, FAILED and NOT_FOUND transactions', async () => {
    const fetch = fakeRpcFetch((method, params) => {
      expect(method).toBe('getTransaction')
      const hash = params!.hash as string
      if (hash.startsWith('a')) return successResponse(hash, [[event()]])
      if (hash.startsWith('b')) return failedResponse(hash)
      return notFoundResponse(hash)
    })
    const rpc = createRpcClient({ url: 'https://rpc.example', fetch })
    const ok = await rpc.getTransaction(HASH.toUpperCase())
    expect(ok).toMatchObject({ status: 'SUCCESS', ledger: 6_000_000 })
    expect(ok.contractEventsXdr[0]).toHaveLength(1)
    expect((await rpc.getTransaction('b'.repeat(64))).status).toBe('FAILED')
    expect(await rpc.getTransaction('c'.repeat(64))).toMatchObject({
      status: 'NOT_FOUND',
      ledger: null,
      contractEventsXdr: [],
    })
    expect(fetch.calls[0]!.params).toEqual({ hash: HASH })
  })

  it('classifies network, HTTP and JSON-RPC failures', async () => {
    const cases: Array<[unknown, string]> = [
      [new Error('socket hang up'), 'transient'],
      [{ httpStatus: 503 }, 'transient'],
      [{ httpStatus: 429 }, 'transient'],
      [{ httpStatus: 400 }, 'permanent'],
      [{ error: { code: -32603, message: 'internal' } }, 'transient'],
      [{ error: { code: -32602, message: 'invalid params' } }, 'permanent'],
      [{ status: 'WEIRD' }, 'permanent'],
    ]
    for (const [response, kind] of cases) {
      const rpc = createRpcClient({
        url: 'https://rpc.example',
        fetch: fakeRpcFetch(() => response),
      })
      const error = await rpc.getTransaction(HASH).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(RpcError)
      expect((error as RpcError).kind).toBe(kind)
    }
    const rpc = createRpcClient({
      url: 'https://rpc.example',
      fetch: fakeRpcFetch(() => ({})),
    })
    await expect(rpc.getTransaction('nothex')).rejects.toMatchObject({
      kind: 'permanent',
    })
  })

  it('reads health, latest ledger, events and simulation results', async () => {
    const rpc = createRpcClient({
      url: 'https://rpc.example',
      fetch: fakeRpcFetch((method) => {
        if (method === 'getHealth') {
          return {
            status: 'healthy',
            latestLedger: 10,
            latestLedgerCloseTime: '100',
            oldestLedger: 1,
            oldestLedgerCloseTime: '1',
            ledgerRetentionWindow: 120960,
          }
        }
        if (method === 'getLatestLedger') {
          return { id: 'x', sequence: 10, protocolVersion: 23 }
        }
        if (method === 'getEvents') {
          return { events: [], cursor: 'c1', latestLedger: 10 }
        }
        return { latestLedger: 10, results: [{ xdr: 'AAAAAQAAAAE=' }] }
      }),
    })
    expect((await rpc.getHealth()).ledgerRetentionWindow).toBe(120960)
    expect((await rpc.getLatestLedger()).sequence).toBe(10)
    expect((await rpc.getEvents({ filters: [] })).cursor).toBe('c1')
    expect((await rpc.simulateTransaction('AAAA')).retvalXdr).toBe(
      'AAAAAQAAAAE='
    )
  })
})

describe('network guard on chain endpoints', () => {
  it('uses the testnet RPC and refuses mainnet settings', () => {
    expect(backendRpcUrl({ STELLAR_NETWORK: 'TESTNET' })).toBe(
      'https://soroban-testnet.stellar.org'
    )
    expect(() => backendRpcUrl({ STELLAR_NETWORK: 'MAINNET' })).toThrow()
    expect(() =>
      backendRpcUrl({
        STELLAR_NETWORK: 'TESTNET',
        STELLAR_RPC_URL: 'https://mainnet.sorobanrpc.com',
      })
    ).toThrow()
    expect(() =>
      readChainEnv({
        STELLAR_NETWORK: 'TESTNET',
        NETWORK_PASSPHRASE: 'Public Global Stellar Network ; September 2015',
      })
    ).toThrow()
    expect(() =>
      readChainEnv({ STELLAR_NETWORK: 'TESTNET', CORE_CONTRACT_ID: 'nope' })
    ).toThrow()
  })
})
