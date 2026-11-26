/**
 * Client side of the v2 tip flows (docs/architecture/v2/05-flows-and-admin.md,
 * sections 5.2 to 5.4): the tip call encoder, its checks against the client
 * configuration and the request, and the runner that prepares, signs, sends
 * and records. RPC, the wallet and Convex are fakes; nothing is sent.
 */
import {
  Account,
  Address,
  Keypair,
  Networks,
  SorobanDataBuilder,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
  type Transaction,
} from '@stellar/stellar-sdk'
import { ConvexError } from 'convex/values'
import { describe, expect, it } from 'vitest'
import vectors from '../../contracts/shared/test-vectors.json'
import type { PreparedTip } from '../../convex/tipsV2'
import { highlightIdHex } from '../../convex/lib/chain/ids'
import { bytesToHex } from '../../lib/stellar/bytes'
import { highlightId } from '../../lib/stellar/v2/ids'
import {
  TipCallError,
  baseUnits,
  checkPreparedTip,
  hexBytes,
  tipContractCall,
  type RequestedTipItem,
} from '../../lib/stellar/v2/tip-calls'
import { runTip, type TipRunDeps } from '../../lib/stellar/v2/tip-actions'
import type { RpcLike } from '../../lib/stellar/v2/tx'
import { WalletError } from '../../lib/stellar/v2/wallet-errors'

const CORE = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const OTHER_CONTRACT = 'CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS'
const tipper = Keypair.random()
const TIPPER = tipper.publicKey()

const receipts = vectors.receipts.items
const ARTICLE_KEY = receipts[0]!.article_id
const VECTOR = vectors.identifiers.highlight_ids[0]!
// "on-writing-well:120:163:The quick brown fox jumps over the lazy dog"
const [SLUG, START, END, ...rest] = VECTOR.source.split(':')
const PASSAGE = {
  articleSlug: SLUG!,
  startOffset: Number(START),
  endOffset: Number(END),
  text: rest.join(':'),
}

const NOW_MS = 1_900_000_000_000
const MAX_TIME = NOW_MS / 1000 + 300

function quote(gross: string) {
  const fee = (BigInt(gross) * BigInt(250)) / BigInt(10_000)
  return {
    amountCents: 100,
    priceUsd: 0.25,
    priceSource: 'test',
    priceFetchedAt: NOW_MS,
    grossBaseUnits: gross,
    grossXlm: '4',
    feeBaseUnits: fee.toString(),
    netBaseUnits: (BigInt(gross) - fee).toString(),
    feeBps: 250,
  }
}

type Item = PreparedTip['items'][number]

function item(overrides: Partial<Item['tipInput']> = {}, articleId = 'a1'): Item {
  const tipInput = {
    article_id: ARTICLE_KEY,
    amount: receipts[0]!.amount,
    highlight_id: null,
    client_ref: receipts[0]!.client_ref,
    ...overrides,
  }
  return {
    table: tipInput.highlight_id ? 'highlightTips' : 'tips',
    tipId: `tip-${articleId}` as Item['tipId'],
    articleId: articleId as Item['articleId'],
    tipInput,
    legacyHighlightId: null,
    authorAddress: TIPPER,
    quote: quote(tipInput.amount),
  }
}

function prepared(items: Item[], overrides: Partial<PreparedTip> = {}) {
  return {
    submissionId: 'sub-1' as PreparedTip['submissionId'],
    method: items.length === 1 ? 'tip' : 'tip_batch',
    status: 'PREPARED',
    existing: false,
    network: 'TESTNET',
    networkPassphrase: Networks.TESTNET,
    chainEpoch: 'test',
    contractId: CORE,
    tokenContractId: TOKEN,
    tipperAddress: TIPPER,
    maxTime: MAX_TIME,
    items,
    totals: {
      amountCents: 100,
      grossBaseUnits: '0',
      grossXlm: '0',
      feeBaseUnits: '0',
      netBaseUnits: '0',
    },
    ...overrides,
  } as PreparedTip
}

const expectation = (items: RequestedTipItem[]) => ({
  networkPassphrase: Networks.TESTNET,
  coreContractId: CORE,
  tokenContractId: TOKEN,
  items,
  now: NOW_MS,
})

// Hand-built ScVals in the shape Soroban expects for Core's arguments.
const addr = (a: string) => xdr.ScVal.scvAddress(new Address(a).toScAddress())
const bytes = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex, 'hex'))
const i128 = (v: string) => nativeToScVal(BigInt(v), { type: 'i128' })
const optBytes = (hex: string | null) =>
  hex === null ? xdr.ScVal.scvVoid() : bytes(hex)
const sym = (s: string) => xdr.ScVal.scvSymbol(s)
function tipInputScVal(i: Item['tipInput']) {
  // A contracttype struct is a map with symbol keys in sorted order.
  return xdr.ScVal.scvMap([
    new xdr.ScMapEntry({ key: sym('amount'), val: i128(i.amount) }),
    new xdr.ScMapEntry({ key: sym('article_id'), val: bytes(i.article_id) }),
    new xdr.ScMapEntry({ key: sym('client_ref'), val: bytes(i.client_ref) }),
    new xdr.ScMapEntry({
      key: sym('highlight_id'),
      val: optBytes(i.highlight_id),
    }),
  ])
}
const xdrOf = (vals: xdr.ScVal[]) => vals.map((v) => v.toXDR('base64'))
/** The invoked function and contract of a built transaction (SDK 17 objects). */
function invokeArgs(tx: Transaction): { fn: string; contract: string } {
  const op = tx.operations[0] as unknown as {
    func: {
      invokeContract: {
        functionName: { toString(): string }
        contractAddress: xdr.ScAddress
      }
    }
  }
  const invoke = op.func.invokeContract
  return {
    fn: invoke.functionName.toString(),
    contract: Address.fromScAddress(invoke.contractAddress).toString(),
  }
}

describe('identifiers', () => {
  it('derives highlight_id as the shared vectors and Convex do', async () => {
    for (const v of vectors.identifiers.highlight_ids) {
      const [slug, start, end, ...text] = v.source.split(':')
      const local = bytesToHex(
        highlightId(slug!, Number(start), Number(end), text.join(':'))
      )
      expect(local).toBe(v.highlight_id)
      expect(local).toBe(await highlightIdHex(v.source))
      expect(local.slice(0, 28)).toBe(v.v1_convex_id)
    }
  })

  it('cuts the passage at 50 characters', () => {
    const long = 'x'.repeat(80)
    expect(bytesToHex(highlightId('s', 0, 80, long))).toBe(
      bytesToHex(highlightId('s', 0, 80, long.slice(0, 50)))
    )
  })
})

describe('tip call encoder', () => {
  it('encodes Core.tip byte for byte, for an article tip', () => {
    const p = prepared([item()])
    const call = tipContractCall(p)
    const i = p.items[0]!.tipInput
    expect(call).toMatchObject({
      contractId: CORE,
      method: 'tip',
      source: TIPPER,
      maxTime: MAX_TIME,
      networkPassphrase: Networks.TESTNET,
    })
    expect(xdrOf(call.args)).toEqual(
      xdrOf([
        addr(TIPPER),
        bytes(i.article_id),
        addr(TOKEN),
        i128(i.amount),
        xdr.ScVal.scvVoid(),
        bytes(i.client_ref),
      ])
    )
  })

  it('encodes Core.tip with a highlight_id', () => {
    const p = prepared([item({ highlight_id: VECTOR.highlight_id })])
    const call = tipContractCall(p)
    expect(call.args[4]!.toXDR('base64')).toBe(
      bytes(VECTOR.highlight_id).toXDR('base64')
    )
    expect(bytesToHex(scValToNative(call.args[4]!) as Uint8Array)).toBe(
      VECTOR.highlight_id
    )
  })

  it('encodes Core.tip_batch with every TipInput in order', () => {
    const items = receipts.map((r, n) =>
      item(
        {
          article_id: r.article_id,
          amount: r.amount,
          client_ref: r.client_ref,
          highlight_id: r.highlight_id,
        },
        `a${n}`
      )
    )
    const p = prepared(items)
    const call = tipContractCall(p)
    expect(call.method).toBe('tip_batch')
    expect(xdrOf(call.args)).toEqual(
      xdrOf([
        addr(TIPPER),
        addr(TOKEN),
        xdr.ScVal.scvVec(items.map((x) => tipInputScVal(x.tipInput))),
      ])
    )
    // Round trip through the native view, as the contract reads it.
    const decoded = scValToNative(call.args[2]!) as Array<{
      amount: bigint
      client_ref: Uint8Array
      highlight_id: Uint8Array | null
    }>
    expect(decoded.map((d) => d.amount.toString())).toEqual(
      receipts.map((r) => r.amount)
    )
    expect(decoded.map((d) => bytesToHex(d.client_ref))).toEqual(
      receipts.map((r) => r.client_ref)
    )
  })

  it('carries an i128 amount beyond 2^53 exactly', () => {
    const big = '9007199254740993'
    const call = tipContractCall(prepared([item({ amount: big })]))
    expect((scValToNative(call.args[3]!) as bigint).toString()).toBe(big)
  })

  it('refuses malformed values', () => {
    expect(() => hexBytes('AB'.repeat(32), 32, 'x')).toThrow(TipCallError)
    expect(() => hexBytes('ab'.repeat(31), 32, 'x')).toThrow(TipCallError)
    expect(() => baseUnits('0', 'amount')).toThrow(TipCallError)
    expect(() => baseUnits('-1', 'amount')).toThrow(TipCallError)
    expect(() => baseUnits('1.5', 'amount')).toThrow(TipCallError)
    expect(() => baseUnits('1'.repeat(40), 'amount')).toThrow(TipCallError)
    expect(() =>
      tipContractCall(prepared([item({ client_ref: 'ab'.repeat(15) })]))
    ).toThrow(/client_ref/)
    expect(() =>
      tipContractCall(prepared([item()], { method: 'tip_batch' }))
    ).toThrow(/2 to 10/)
  })
})

describe('prepared tip checks', () => {
  const article = { articleId: 'a1', articleKey: ARTICLE_KEY }

  it('accepts a response that matches the request', () => {
    expect(() =>
      checkPreparedTip(prepared([item()]), expectation([article]))
    ).not.toThrow()
    expect(() =>
      checkPreparedTip(
        prepared([item({ highlight_id: VECTOR.highlight_id })]),
        expectation([{ ...article, highlight: PASSAGE }])
      )
    ).not.toThrow()
  })

  const refusals: Array<[string, PreparedTip, RequestedTipItem[], RegExp]> = [
    [
      'another network',
      prepared([item()], { networkPassphrase: Networks.PUBLIC }),
      [article],
      /another network/,
    ],
    [
      'another Core',
      prepared([item()], { contractId: OTHER_CONTRACT }),
      [article],
      /another contract/,
    ],
    [
      'another token',
      prepared([item()], { tokenContractId: OTHER_CONTRACT }),
      [article],
      /another token/,
    ],
    [
      'an invalid tipper',
      prepared([item()], { tipperAddress: 'GBAD' }),
      [article],
      /tipping address/,
    ],
    [
      'an expired time bound',
      prepared([item()], { maxTime: NOW_MS / 1000 }),
      [article],
      /timed out/,
    ],
    [
      'a time bound too far ahead',
      prepared([item()], { maxTime: NOW_MS / 1000 + 3600 }),
      [article],
      /timed out/,
    ],
    [
      'a different item count',
      prepared([item(), item({ client_ref: 'cd'.repeat(16) }, 'a2')]),
      [article],
      /do not match/,
    ],
    [
      'the wrong method',
      prepared([item()], { method: 'tip_batch' }),
      [article],
      /do not match/,
    ],
    [
      'another article',
      prepared([item({ article_id: 'cd'.repeat(32) })]),
      [article],
      /article ID/,
    ],
    [
      'an amount that differs from the quote',
      prepared([{ ...item(), quote: quote('1') }]),
      [article],
      /quote/,
    ],
    [
      'a passage the reader did not choose',
      prepared([item({ highlight_id: VECTOR.highlight_id })]),
      [article],
      /did not choose/,
    ],
    [
      'a missing passage',
      prepared([item()]),
      [{ ...article, highlight: PASSAGE }],
      /missing the passage/,
    ],
    [
      'another passage',
      prepared([item({ highlight_id: 'ef'.repeat(32) })]),
      [{ ...article, highlight: PASSAGE }],
      /passage ID/,
    ],
    [
      'two items with one client_ref',
      prepared([item(), item({}, 'a2')]),
      [article, { articleId: 'a2' }],
      /share one reference/,
    ],
    [
      'items in another order',
      prepared([item({}, 'a2'), item({ client_ref: 'cd'.repeat(16) })]),
      [article, { articleId: 'a2' }],
      /another order/,
    ],
  ]

  for (const [name, p, request, message] of refusals) {
    it(`refuses ${name}`, () => {
      expect(() => checkPreparedTip(p, expectation(request))).toThrow(message)
    })
  }

  it('refuses when the client has no Core or token configured', () => {
    expect(() =>
      checkPreparedTip(prepared([item()]), {
        ...expectation([article]),
        coreContractId: null,
      })
    ).toThrow(/another contract/)
    expect(() =>
      checkPreparedTip(prepared([item()]), {
        ...expectation([article]),
        tokenContractId: null,
      })
    ).toThrow(/another token/)
  })
})

// ---------------------------------------------------------------------------
// Runner

type Calls = {
  prepared: string[]
  submitted: Array<[string, string]>
  failed: Array<[string, string, string | undefined]>
  steps: string[]
  sent: string[]
}

function fakeServer(options: {
  simulation?: 'ok' | 'error'
  simulationError?: string
  events?: unknown[]
  send?: 'PENDING' | 'ERROR' | 'TRY_AGAIN_LATER'
}): RpcLike {
  return {
    getAccount: async (id: string) => new Account(id, '1'),
    simulateTransaction: async () =>
      options.simulation === 'error'
        ? ({
            error: options.simulationError ?? 'HostError: Error(Contract, #8)',
            events: options.events ?? [],
            id: '1',
            latestLedger: 1,
            _parsed: true,
          } as unknown as rpc.Api.SimulateTransactionErrorResponse)
        : ({
            id: '1',
            latestLedger: 1,
            events: [],
            _parsed: true,
            transactionData: new SorobanDataBuilder(),
            minResourceFee: '100',
            result: { auth: [], retval: xdr.ScVal.scvVoid() },
          } as unknown as rpc.Api.SimulateTransactionSuccessResponse),
    sendTransaction: async (tx: Transaction) =>
      ({
        status: options.send ?? 'PENDING',
        hash: bytesToHex(tx.hash()),
      }) as rpc.Api.SendTransactionResponse,
    getTransaction: async () =>
      ({ status: 'NOT_FOUND' }) as rpc.Api.GetTransactionResponse,
  } as unknown as RpcLike
}

function deps(
  overrides: Partial<TipRunDeps> & {
    server?: RpcLike
    response?: PreparedTip
  } = {}
): { deps: TipRunDeps; calls: Calls } {
  const calls: Calls = {
    prepared: [],
    submitted: [],
    failed: [],
    steps: [],
    sent: [],
  }
  const response = overrides.response ?? prepared([item()])
  const base: TipRunDeps = {
    config: {
      passphrase: Networks.TESTNET,
      coreContractId: CORE,
      tokenContractId: TOKEN,
    },
    server: overrides.server ?? fakeServer({}),
    request: [{ articleId: 'a1', articleKey: ARTICLE_KEY }],
    requestId: 'req-1',
    prepare: async (requestId) => {
      calls.prepared.push(requestId)
      return response
    },
    connect: async () => TIPPER,
    sign: async (envelope) => {
      const tx = TransactionBuilder.fromXDR(
        envelope,
        Networks.TESTNET
      ) as Transaction
      tx.sign(tipper)
      return tx.toXDR()
    },
    recordSubmitted: async (id, hash) => {
      calls.submitted.push([id, hash])
    },
    recordSendFailed: async (id, reason, detail) => {
      calls.failed.push([id, reason, detail])
    },
    onStep: (step) => calls.steps.push(step),
    onSent: (_, hash) => calls.sent.push(hash),
    now: () => NOW_MS,
    sleep: async () => undefined,
  }
  return { deps: { ...base, ...overrides }, calls }
}

describe('tip runner', () => {
  it('prepares, signs as the tipper, sends and records the hash', async () => {
    let signedEnvelope = ''
    const { deps: d, calls } = deps({
      sign: async (envelope, address) => {
        expect(address).toBe(TIPPER)
        const tx = TransactionBuilder.fromXDR(
          envelope,
          Networks.TESTNET
        ) as Transaction
        tx.sign(tipper)
        signedEnvelope = tx.toXDR()
        return signedEnvelope
      },
    })
    const result = await runTip(d)
    expect(result.kind).toBe('sent')
    expect(calls.prepared).toEqual(['req-1'])
    expect(calls.steps).toEqual(['simulating', 'signing', 'sending'])
    const tx = TransactionBuilder.fromXDR(
      signedEnvelope,
      Networks.TESTNET
    ) as Transaction
    expect(tx.source).toBe(TIPPER)
    expect(tx.timeBounds).toEqual({ minTime: '0', maxTime: String(MAX_TIME) })
    const invoke = invokeArgs(tx)
    expect(invoke).toEqual({ fn: 'tip', contract: CORE })
    const hash = bytesToHex(tx.hash())
    expect(calls.sent).toEqual([hash])
    expect(calls.submitted).toEqual([['sub-1', hash]])
    expect(calls.failed).toEqual([])
  })

  it('never reports confirmation itself', async () => {
    const { deps: d } = deps()
    const result = await runTip(d)
    expect(JSON.stringify(result)).not.toMatch(/CONFIRMED|confirmed/)
  })

  it('returns a server refusal without creating anything', async () => {
    const error = new ConvexError({ code: 'PAUSED', message: 'paused' })
    const { deps: d, calls } = deps({
      prepare: async () => {
        throw error
      },
    })
    const result = await runTip(d)
    expect(result).toEqual({ kind: 'prepare_failed', error })
    expect(calls.failed).toEqual([])
  })

  it('retries a lost prepare response once with the same requestId', async () => {
    const seen: string[] = []
    const { deps: d } = deps({
      prepare: async (requestId) => {
        seen.push(requestId)
        if (seen.length === 1) throw new TypeError('fetch failed')
        return prepared([item()])
      },
    })
    expect((await runTip(d)).kind).toBe('sent')
    expect(seen).toEqual(['req-1', 'req-1'])
  })

  it('follows a replayed record that was already sent', async () => {
    const { deps: d, calls } = deps({
      response: prepared([item()], { status: 'SUBMITTED', existing: true }),
    })
    const result = await runTip(d)
    expect(result.kind).toBe('tracking')
    expect(calls.steps).toEqual([])
    expect(calls.failed).toEqual([])
  })

  it('records a refused local check and signs nothing', async () => {
    let signed = false
    const { deps: d, calls } = deps({
      response: prepared([item()], { tokenContractId: OTHER_CONTRACT }),
      sign: async () => {
        signed = true
        return ''
      },
    })
    const result = await runTip(d)
    expect(result.kind).toBe('check_failed')
    expect(signed).toBe(false)
    expect(calls.failed).toEqual([['sub-1', 'wallet_rejected', 'client_check']])
  })

  it('refuses a wallet on another account', async () => {
    const other = Keypair.random().publicKey()
    const { deps: d, calls } = deps({ connect: async () => other })
    const result = await runTip(d)
    expect(result).toMatchObject({
      kind: 'wrong_account',
      expected: TIPPER,
      actual: other,
    })
    expect(calls.failed).toEqual([
      ['sub-1', 'wallet_rejected', 'wrong_account'],
    ])
  })

  it('returns to the form when the picker is closed', async () => {
    const { deps: d, calls } = deps({ connect: async () => null })
    const result = await runTip(d)
    expect(result).toMatchObject({
      kind: 'stopped',
      view: { show: { kind: 'cancelled' } },
    })
    expect(calls.failed).toEqual([['sub-1', 'wallet_rejected', 'cancelled']])
  })

  it('records a wallet refusal as wallet_rejected and shows declined', async () => {
    const { deps: d, calls } = deps({
      sign: async () => {
        throw new WalletError('rejected', 'User declined')
      },
    })
    const result = await runTip(d)
    expect(result).toMatchObject({
      kind: 'stopped',
      view: { show: { kind: 'declined' } },
    })
    expect(calls.failed).toEqual([['sub-1', 'wallet_rejected', 'rejected']])
    expect(calls.submitted).toEqual([])
  })

  it('maps a locked wallet while connecting to the gate', async () => {
    const { deps: d, calls } = deps({
      connect: async () => {
        throw new WalletError('locked', 'locked')
      },
    })
    const result = await runTip(d)
    expect(result).toMatchObject({
      kind: 'stopped',
      view: { show: { kind: 'gate', gate: { kind: 'locked' } } },
    })
    expect(calls.failed).toEqual([['sub-1', 'wallet_rejected', 'locked']])
  })

  const errorEvent = (contractId: string, code: number) => ({
    toJSON: () => ({
      event: {
        contract_id: contractId,
        body: {
          v0: { topics: [{ symbol: 'error' }, { error: { contract: code } }] },
        },
      },
    }),
  })

  it('records a simulation failure with the decoded name', async () => {
    const { deps: d, calls } = deps({
      server: fakeServer({ simulation: 'error', events: [errorEvent(CORE, 8)] }),
    })
    const result = await runTip(d)
    expect(result.kind).toBe('stopped')
    expect(calls.failed).toEqual([
      ['sub-1', 'simulation_failed', 'BelowMinimum'],
    ])
  })

  it('shows the balance notice for the token balance error (#507)', async () => {
    const event = {
      toJSON: () => ({
        event: {
          contract_id: TOKEN,
          body: {
            v0: { topics: [{ symbol: 'error' }, { error: { contract: 10 } }] },
          },
        },
      }),
    }
    const { deps: d, calls } = deps({
      server: fakeServer({
        simulation: 'error',
        simulationError: 'HostError: Error(Contract, #10)',
        events: [event],
      }),
    })
    const result = await runTip(d)
    expect(result).toMatchObject({
      kind: 'stopped',
      view: {
        show: { kind: 'notice', notice: { kind: 'insufficient-balance' } },
      },
    })
    expect(calls.failed).toEqual([
      ['sub-1', 'simulation_failed', 'BalanceError'],
    ])
  })

  it('shows a generic failure when the raising contract is unknown', async () => {
    const { deps: d, calls } = deps({
      server: fakeServer({
        simulation: 'error',
        simulationError: 'HostError: Error(Contract, #10)',
      }),
    })
    const result = await runTip(d)
    expect(result).toMatchObject({
      kind: 'stopped',
      view: { show: { kind: 'failed' } },
    })
    expect(calls.failed).toEqual([['sub-1', 'simulation_failed', undefined]])
  })

  it('keeps following when Core says the reference already paid', async () => {
    const event = {
      toJSON: () => ({
        event: {
          contract_id: CORE,
          body: {
            v0: { topics: [{ symbol: 'error' }, { error: { contract: 10 } }] },
          },
        },
      }),
    }
    const { deps: d, calls } = deps({
      server: fakeServer({
        simulation: 'error',
        simulationError: 'HostError: Error(Contract, #10)',
        events: [event],
      }),
    })
    const result = await runTip(d)
    expect(result.kind).toBe('tracking')
    expect(calls.failed).toEqual([])
  })

  it('records a send error', async () => {
    const { deps: d, calls } = deps({ server: fakeServer({ send: 'ERROR' }) })
    const result = await runTip(d)
    expect(result.kind).toBe('stopped')
    expect(calls.failed[0]?.[1]).toBe('send_error')
    expect(calls.submitted).toEqual([])
  })

  it('reports sent when recordSubmitted fails, for the indexer to confirm', async () => {
    const { deps: d, calls } = deps({
      recordSubmitted: async () => {
        throw new Error('offline')
      },
    })
    const result = await runTip(d)
    expect(result).toMatchObject({ kind: 'sent', recorded: false })
    expect(calls.sent).toHaveLength(1)
    expect(calls.failed).toEqual([])
  })

  it('sends a batch as one tip_batch signed once', async () => {
    let signs = 0
    const items = [
      item({}, 'a1'),
      item(
        {
          client_ref: receipts[1]!.client_ref,
          highlight_id: VECTOR.highlight_id,
        },
        'a2'
      ),
    ]
    const { deps: d } = deps({
      response: prepared(items),
      request: [
        { articleId: 'a1', articleKey: ARTICLE_KEY },
        { articleId: 'a2', highlight: PASSAGE },
      ],
      sign: async (envelope) => {
        signs++
        const tx = TransactionBuilder.fromXDR(
          envelope,
          Networks.TESTNET
        ) as Transaction
        expect(invokeArgs(tx)).toEqual({ fn: 'tip_batch', contract: CORE })
        tx.sign(tipper)
        return tx.toXDR()
      },
    })
    expect((await runTip(d)).kind).toBe('sent')
    expect(signs).toBe(1)
  })
})
