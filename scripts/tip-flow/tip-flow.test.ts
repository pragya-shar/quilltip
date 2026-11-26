/**
 * The v2 tip flow state machine (lib/tip/v2/flow.ts), the prepare refusal
 * map, the basket rules and store, amounts and the reload record. Pure; no
 * Convex, wallet or network.
 */
import { describe, expect, it } from 'vitest'
import { ConvexError } from 'convex/values'
import { TIP_V2_ERROR_CODES } from '../../convex/lib/chain/tipPrepare'
import {
  INITIAL_FLOW,
  isFinalUiState,
  moneyMayHaveMoved,
  progressSource,
  tipFlowReducer,
  type TipFlowEvent,
  type TipFlowState,
} from '../../lib/tip/v2/flow'
import {
  PREPARE_REFUSALS,
  refusalFromPrepareError,
} from '../../lib/tip/v2/prepare-errors'
import {
  BasketStore,
  MAX_BASKET_ITEMS,
  MAX_BASKET_TRANSFERS,
  batchRequest,
  canAddToBasket,
  parseBasket,
  type BasketItem,
} from '../../lib/tip/v2/basket'
import {
  checkAmount,
  estimateBaseUnits,
  formatCents,
  parseDollars,
} from '../../lib/tip/v2/amount'
import {
  PENDING_TTL_MS,
  articleScope,
  highlightScope,
  parsePending,
  pendingKey,
} from '../../lib/tip/v2/pending'
import { deriveProgress } from '../../lib/payments/ui-state'
import { centsToBaseUnits } from '../../convex/lib/chain/tipPrepare'
import { tipGateState } from '../../lib/tip/v2/gate'

function run(events: TipFlowEvent[], from: TipFlowState = INITIAL_FLOW) {
  return events.reduce(tipFlowReducer, from)
}

const record = (status: string, extra: Record<string, unknown> = {}) => ({
  status,
  mismatchReason: null,
  needsReview: false,
  items: [{ status, mismatchReason: null }],
  ...extra,
})

describe('tip flow reducer', () => {
  it('runs prepare, the wallet steps and the send', () => {
    const s1 = run([{ type: 'start', requestId: 'r1' }])
    expect(s1).toMatchObject({ stage: 'preparing', requestId: 'r1' })
    const s2 = run([{ type: 'prepared', submissionId: 's1' }], s1)
    expect(s2).toMatchObject({
      stage: 'tracking',
      submissionId: 's1',
      step: 'simulating',
    })
    const s3 = run(
      [
        { type: 'step', step: 'signing' },
        { type: 'step', step: 'sending' },
        {
          type: 'outcome',
          view: { show: { kind: 'sent', hash: 'ab'.repeat(32) }, record: null },
        },
      ],
      s2
    )
    expect(s3).toMatchObject({
      stage: 'tracking',
      step: null,
      txHash: 'ab'.repeat(32),
      declined: false,
      failure: null,
    })
  })

  it('ignores a second start while preparing', () => {
    const s1 = run([{ type: 'start', requestId: 'r1' }])
    expect(tipFlowReducer(s1, { type: 'start', requestId: 'r2' })).toBe(s1)
  })

  it('ignores late events from an earlier stage', () => {
    expect(tipFlowReducer(INITIAL_FLOW, { type: 'step', step: 'signing' })).toBe(
      INITIAL_FLOW
    )
    expect(
      tipFlowReducer(INITIAL_FLOW, { type: 'prepared', submissionId: 's' })
    ).toBe(INITIAL_FLOW)
  })

  it('returns a refusal to the form with its condition', () => {
    const s = run([
      { type: 'start', requestId: 'r1' },
      {
        type: 'refused',
        refusal: refusalFromPrepareError(
          new ConvexError({ code: 'PAUSED', message: 'x' })
        ),
      },
    ])
    expect(s).toMatchObject({ stage: 'form', condition: { kind: 'paused' } })
  })

  const tracking = run([
    { type: 'start', requestId: 'r1' },
    { type: 'prepared', submissionId: 's1' },
    { type: 'step', step: 'signing' },
  ])

  it('marks a wallet refusal declined and keeps the record', () => {
    const s = tipFlowReducer(tracking, {
      type: 'outcome',
      view: {
        show: { kind: 'declined' },
        record: { reason: 'wallet_rejected', detail: 'rejected' },
      },
    })
    expect(s).toMatchObject({
      stage: 'tracking',
      submissionId: 's1',
      declined: true,
      step: null,
    })
  })

  it('goes back to the form when the picker closes', () => {
    const s = tipFlowReducer(tracking, {
      type: 'outcome',
      view: { show: { kind: 'cancelled' }, record: null },
    })
    expect(s).toMatchObject({ stage: 'form', submissionId: null })
  })

  it('shows the wallet gate and a notice with the form', () => {
    const gate = tipFlowReducer(tracking, {
      type: 'outcome',
      view: {
        show: { kind: 'gate', gate: { kind: 'wrong-network' } },
        record: { reason: 'wallet_rejected' },
      },
    })
    expect(gate).toMatchObject({
      stage: 'form',
      condition: { kind: 'gate', gate: { kind: 'wrong-network' } },
    })
    const balance = tipFlowReducer(tracking, {
      type: 'outcome',
      view: {
        show: {
          kind: 'notice',
          notice: { kind: 'insufficient-balance', source: 'wallet' },
        },
        record: { reason: 'simulation_failed' },
      },
    })
    expect(balance.condition).toEqual({ kind: 'insufficient-balance' })
    const withAmounts = tipFlowReducer(balance, {
      type: 'balance',
      needed: '40000000',
      available: '1000',
    })
    expect(withAmounts.condition).toEqual({
      kind: 'insufficient-balance',
      needed: '40000000',
      available: '1000',
    })
  })

  it('keeps failure copy for the failed result', () => {
    const s = tipFlowReducer(tracking, {
      type: 'outcome',
      view: {
        show: {
          kind: 'failed',
          failure: { title: 'Not sent', detail: 'Nothing was paid.' },
        },
        record: { reason: 'send_error' },
      },
    })
    expect(s.failure).toEqual({ title: 'Not sent', detail: 'Nothing was paid.' })
  })

  it('resumes a stored submission after a reload', () => {
    const s = tipFlowReducer(INITIAL_FLOW, {
      type: 'resume',
      submissionId: 's9',
      txHash: null,
    })
    expect(s).toMatchObject({ stage: 'tracking', submissionId: 's9', step: null })
  })

  it('starts a retry from scratch with a new requestId', () => {
    const failed = tipFlowReducer(tracking, {
      type: 'outcome',
      view: { show: { kind: 'declined' }, record: null },
    })
    const retry = tipFlowReducer(failed, { type: 'start', requestId: 'r2' })
    expect(retry).toEqual({
      ...INITIAL_FLOW,
      stage: 'preparing',
      requestId: 'r2',
    })
  })
})

describe('progress source', () => {
  const tracking = run([
    { type: 'start', requestId: 'r1' },
    { type: 'prepared', submissionId: 's1' },
    { type: 'step', step: 'signing' },
  ])

  it('shows nothing on the form and Prepare while preparing', () => {
    expect(progressSource(INITIAL_FLOW, undefined)).toBeNull()
    expect(
      progressSource(run([{ type: 'start', requestId: 'r' }]), undefined)
    ).toEqual({ clientStep: 'simulating' })
  })

  it('shows the live step while the record is PREPARED', () => {
    const source = progressSource(tracking, record('PREPARED'))!
    expect(deriveProgress(source).phase).toBe('signing')
  })

  it('lets the server decide after the send', () => {
    const sent = tipFlowReducer(tracking, { type: 'pending_elsewhere' })
    expect(deriveProgress(progressSource(sent, record('SUBMITTED'))!)).toEqual(
      { phase: 'checking', retry: false, redirected: 0 }
    )
    expect(
      deriveProgress(progressSource(sent, record('CONFIRMED'))!).phase
    ).toBe('confirmed')
  })

  it('never confirms from the client: a final client step is not a phase', () => {
    // The flow has no event that sets a confirmed phase; only the record does.
    for (const status of ['PREPARED', 'SUBMITTED', 'FAILED', 'EXPIRED']) {
      expect(
        deriveProgress(progressSource(tracking, record(status))!).phase
      ).not.toBe('confirmed')
    }
  })

  it('offers a retry only after FAILED or EXPIRED, never after MISMATCH', () => {
    const idle = tipFlowReducer(tracking, { type: 'pending_elsewhere' })
    const retry = (r: ReturnType<typeof record>) =>
      deriveProgress(progressSource(idle, r)!).retry
    expect(retry(record('FAILED'))).toBe(true)
    expect(retry(record('EXPIRED'))).toBe(true)
    expect(retry(record('FAILED', { needsReview: true }))).toBe(false)
    expect(retry(record('MISMATCH', { mismatchReason: 'author' }))).toBe(false)
    expect(retry(record('MISMATCH', { mismatchReason: 'field:gross' }))).toBe(
      false
    )
    expect(retry(record('SUBMITTED'))).toBe(false)
  })

  it('shows a reload while PREPARED as resuming', () => {
    const resumed = tipFlowReducer(INITIAL_FLOW, {
      type: 'resume',
      submissionId: 's1',
      txHash: null,
    })
    expect(deriveProgress(progressSource(resumed, record('PREPARED'))!).phase).toBe(
      'resuming'
    )
    expect(deriveProgress(progressSource(resumed, undefined)!).phase).toBe(
      'resuming'
    )
  })

  it('reads basket rows: one under review puts the basket under review', () => {
    const idle = tipFlowReducer(tracking, { type: 'pending_elsewhere' })
    const rows = record('MISMATCH', {
      mismatchReason: 'field:gross',
      items: [
        { status: 'CONFIRMED', mismatchReason: null },
        { status: 'MISMATCH', mismatchReason: 'field:gross' },
        { status: 'CONFIRMED', mismatchReason: null },
      ],
    })
    const progress = deriveProgress(progressSource(idle, rows, { batch: true })!)
    expect(progress).toMatchObject({ phase: 'under-review', retry: false })
  })

  it('reads basket rows: redirected rows still confirm, with a count', () => {
    const idle = tipFlowReducer(tracking, { type: 'pending_elsewhere' })
    const rows = record('MISMATCH', {
      mismatchReason: 'author',
      items: [
        { status: 'CONFIRMED', mismatchReason: null },
        { status: 'MISMATCH', mismatchReason: 'author' },
      ],
    })
    expect(
      deriveProgress(progressSource(idle, rows, { batch: true })!)
    ).toMatchObject({ phase: 'confirmed', redirected: 1 })
  })
})

describe('final states', () => {
  it('knows which server states are final and which moved money', () => {
    expect(isFinalUiState('checking')).toBe(false)
    expect(isFinalUiState(undefined)).toBe(false)
    for (const s of [
      'confirmed',
      'mismatch_author',
      'mismatch_review',
      'failed',
      'expired',
    ]) {
      expect(isFinalUiState(s)).toBe(true)
    }
    expect(moneyMayHaveMoved('failed')).toBe(false)
    expect(moneyMayHaveMoved('expired')).toBe(false)
    expect(moneyMayHaveMoved('mismatch_review')).toBe(true)
    expect(moneyMayHaveMoved('mismatch_author')).toBe(true)
  })
})

describe('prepare refusals', () => {
  it('maps every server error code', () => {
    expect(Object.keys(PREPARE_REFUSALS).sort()).toEqual(
      [...TIP_V2_ERROR_CODES].sort()
    )
  })

  const err = (code: string, extra = {}) =>
    new ConvexError({ code, message: 'x', ...extra })

  it('shows account problems as the wallet gate', () => {
    expect(refusalFromPrepareError(err('UNAUTHENTICATED'))).toMatchObject({
      kind: 'gate',
      gate: { kind: 'signed-out' },
    })
    expect(refusalFromPrepareError(err('NO_WALLET'))).toMatchObject({
      kind: 'gate',
      gate: { kind: 'disconnected' },
    })
    expect(
      refusalFromPrepareError(err('ADDRESS_UNVERIFIED'), {
        connectedAddress: 'GABC',
      })
    ).toMatchObject({ gate: { kind: 'unverified', address: 'GABC' } })
  })

  it('shows article problems as tips unavailable, or the basket item', () => {
    expect(refusalFromPrepareError(err('ARTICLE_NOT_REGISTERED'))).toMatchObject(
      { kind: 'tips-unavailable', reason: 'unregistered' }
    )
    expect(refusalFromPrepareError(err('PAYOUT_ADDRESS_CHANGED'))).toMatchObject(
      { kind: 'tips-unavailable', reason: 'payout_outdated' }
    )
    expect(
      refusalFromPrepareError(err('ARTICLE_NOT_REGISTERED', { itemIndex: 2 }), {
        batch: true,
      })
    ).toMatchObject({ kind: 'basket-item-unavailable', itemIndex: 2 })
  })

  it('names the minimum and the wait', () => {
    const below = refusalFromPrepareError(err('BELOW_MINIMUM'), {
      minTipCents: 7,
    })
    expect(below).toMatchObject({ kind: 'refused', amountField: true })
    expect(JSON.stringify(below)).toMatch(/\$0\.07/)
    const limited = refusalFromPrepareError(
      err('RATE_LIMITED', { retryAfterMs: 12_300 })
    )
    expect(JSON.stringify(limited)).toMatch(/Wait 13 seconds/)
    expect(refusalFromPrepareError(err('PAUSED'))).toMatchObject({
      kind: 'paused',
    })
  })

  it('treats a non-server error as offline and says nothing was paid', () => {
    const r = refusalFromPrepareError(new TypeError('fetch failed'))
    expect(r).toMatchObject({ kind: 'refused', code: 'OFFLINE' })
    expect(JSON.stringify(r)).toMatch(/Nothing was paid/)
  })

  it('says nothing was paid on every refusal', () => {
    for (const code of TIP_V2_ERROR_CODES) {
      const r = refusalFromPrepareError(err(code))
      if (r.kind === 'refused' && code !== 'BATCH_EMPTY') {
        expect(r.copy.detail).toMatch(/Nothing was paid/)
      }
    }
  })
})

function basketItem(n: number, transfers = 2): Omit<BasketItem, 'id'> {
  return {
    articleId: `a${n}`,
    articleSlug: `slug-${n}`,
    articleTitle: `Article ${n}`,
    authorName: 'Ada',
    amountCents: 100,
    highlight: null,
    transferCount: transfers,
    articleKey: null,
  }
}

function memoryStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  }
}

describe('basket rules', () => {
  const withIds = (items: Omit<BasketItem, 'id'>[]) =>
    items.map((item, i) => ({ ...item, id: String(i) }))

  it('holds up to 10 tips', () => {
    const nine = withIds(Array.from({ length: 9 }, (_, i) => basketItem(i)))
    expect(canAddToBasket(nine, basketItem(9))).toEqual({ ok: true })
    const ten = withIds(Array.from({ length: 10 }, (_, i) => basketItem(i)))
    expect(canAddToBasket(ten, basketItem(10))).toEqual({
      ok: false,
      reason: 'full_items',
    })
    expect(MAX_BASKET_ITEMS).toBe(10)
  })

  it('holds up to 24 transfers', () => {
    // 4 articles with 4 co-authors each: 5 transfers each = 20.
    const items = withIds(Array.from({ length: 4 }, (_, i) => basketItem(i, 5)))
    expect(canAddToBasket(items, basketItem(5, 4))).toEqual({ ok: true })
    expect(canAddToBasket(items, basketItem(5, 5))).toEqual({
      ok: false,
      reason: 'full_transfers',
      needed: 5,
      left: 4,
    })
    expect(MAX_BASKET_TRANSFERS).toBe(24)
  })

  it('refuses the same tip twice, an unknown article and a busy basket', () => {
    const items = withIds([basketItem(1)])
    expect(canAddToBasket(items, basketItem(1))).toMatchObject({
      reason: 'duplicate',
    })
    // The same article with a passage is a different tip.
    expect(
      canAddToBasket(items, {
        ...basketItem(1),
        highlight: { text: 'x', startOffset: 0, endOffset: 1 },
      })
    ).toEqual({ ok: true })
    expect(canAddToBasket(items, basketItem(2, 0))).toMatchObject({
      reason: 'unavailable',
    })
    expect(canAddToBasket(items, basketItem(2), { busy: true })).toMatchObject({
      reason: 'busy',
    })
  })

  it('builds the prepareBatch items in order', () => {
    const items = withIds([
      basketItem(1),
      {
        ...basketItem(2),
        highlight: {
          text: 'passage',
          startOffset: 3,
          endOffset: 10,
          startContainerPath: 'text.0',
        },
      },
    ])
    expect(batchRequest(items)).toEqual([
      { articleId: 'a1', amountCents: 100 },
      {
        articleId: 'a2',
        amountCents: 100,
        highlight: {
          text: 'passage',
          startOffset: 3,
          endOffset: 10,
          startContainerPath: 'text.0',
        },
      },
    ])
  })
})

describe('basket store', () => {
  it('keeps one basket per account and survives a reload', () => {
    const storage = memoryStorage()
    const store = new BasketStore(storage)
    expect(store.add(basketItem(1))).toMatchObject({ reason: 'unavailable' })
    store.setOwner('user-a')
    expect(store.add(basketItem(1))).toEqual({ ok: true })
    store.add(basketItem(2))
    expect(store.getSnapshot().items).toHaveLength(2)
    const reloaded = new BasketStore(storage)
    reloaded.setOwner('user-a')
    expect(reloaded.getSnapshot().items.map((i) => i.articleId)).toEqual([
      'a1',
      'a2',
    ])
    reloaded.setOwner('user-b')
    expect(reloaded.getSnapshot().items).toEqual([])
  })

  it('locks while paying and clears paid tips only when money moved', () => {
    const store = new BasketStore(memoryStorage())
    store.setOwner('u')
    store.add(basketItem(1))
    store.add(basketItem(2))
    store.startPayment('sub-1')
    expect(store.add(basketItem(3))).toMatchObject({ reason: 'busy' })
    store.finishPayment(false)
    expect(store.getSnapshot()).toMatchObject({ submissionId: null })
    expect(store.getSnapshot().items).toHaveLength(2)
    store.startPayment('sub-2')
    store.finishPayment(true)
    expect(store.getSnapshot().items).toEqual([])
  })

  it('reads a damaged basket as empty', () => {
    expect(parseBasket('not json').items).toEqual([])
    expect(parseBasket(JSON.stringify({ items: [{ id: 1 }] })).items).toEqual(
      []
    )
  })
})

describe('amounts', () => {
  it('parses dollars the reader types', () => {
    expect(parseDollars('1')).toBe(100)
    expect(parseDollars('1.5')).toBe(150)
    expect(parseDollars('$2.05')).toBe(205)
    expect(parseDollars('.25')).toBe(25)
    expect(parseDollars('1,000')).toBe(100_000)
    expect(parseDollars('1.234')).toBeNull()
    expect(parseDollars('abc')).toBeNull()
    expect(parseDollars('')).toBeNull()
    expect(parseDollars('.')).toBeNull()
    expect(parseDollars('-1')).toBeNull()
  })

  it('checks the minimum from the server and the app maximum', () => {
    expect(checkAmount(100, 7)).toEqual({ ok: true, cents: 100 })
    expect(checkAmount(6, 7)).toEqual({ ok: false, reason: 'below', min: 7 })
    expect(checkAmount(7, 7)).toEqual({ ok: true, cents: 7 })
    expect(checkAmount(10_001, 7)).toMatchObject({ reason: 'above' })
    expect(checkAmount(null, 7, '')).toMatchObject({ reason: 'empty' })
    expect(checkAmount(null, 7, 'x')).toMatchObject({ reason: 'invalid' })
    expect(checkAmount(0, null)).toMatchObject({ reason: 'below', min: 1 })
  })

  it('estimates base units with the server formula', () => {
    for (const [cents, price] of [
      [100, 0.2234],
      [1, 0.4471],
      [9_999, 0.11],
    ] as const) {
      expect(estimateBaseUnits(cents, price)).toBe(
        centsToBaseUnits(cents, price).toString()
      )
    }
    expect(estimateBaseUnits(100, 0)).toBe('0')
  })

  it('formats cents', () => {
    expect(formatCents(100)).toBe('$1')
    expect(formatCents(105)).toBe('$1.05')
    expect(formatCents(7)).toBe('$0.07')
    expect(formatCents(10_000)).toBe('$100')
  })
})

describe('reload record', () => {
  it('keeps the submission and a valid hash only', () => {
    const now = 1_000_000
    expect(
      parsePending(
        JSON.stringify({ submissionId: 's', txHash: 'ab'.repeat(32), startedAt: now }),
        now
      )
    ).toEqual({ submissionId: 's', txHash: 'ab'.repeat(32), startedAt: now })
    expect(
      parsePending(
        JSON.stringify({ submissionId: 's', txHash: 'nope', startedAt: now }),
        now
      )?.txHash
    ).toBeNull()
    expect(
      parsePending(
        JSON.stringify({ submissionId: 's', startedAt: now - PENDING_TTL_MS - 1 }),
        now
      )
    ).toBeNull()
    expect(parsePending('{', now)).toBeNull()
  })

  it('keys by account and surface', () => {
    expect(pendingKey('u1', articleScope('a1'))).toBe(
      'quilltip:tip-pending:v2:u1:article:a1'
    )
    expect(highlightScope('a1', 3, 9)).toBe('highlight:a1:3:9')
  })
})

describe('wallet gate', () => {
  const TESTNET = 'Test SDF Network ; September 2015'
  const A = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7'
  const ready = {
    authLoading: false,
    isAuthenticated: true,
    wallet: {
      isLoading: false,
      isConnected: true,
      publicKey: A,
      networkPassphrase: TESTNET,
      networkReported: true,
      errorKind: null,
    },
    expectedPassphrase: TESTNET,
    eligibility: { reason: null, tipperAddress: A },
  }
  const gate = (patch: Record<string, unknown> = {}, wallet = {}) =>
    tipGateState({
      ...ready,
      ...patch,
      wallet: { ...ready.wallet, ...wallet },
    } as Parameters<typeof tipGateState>[0])

  it('is ready when signed in with the linked wallet on testnet', () => {
    expect(gate()).toEqual({ kind: 'ready' })
  })

  it('asks in the order a reader fixes things', () => {
    expect(gate({ authLoading: true })).toEqual({ kind: 'checking' })
    expect(gate({ isAuthenticated: false })).toEqual({ kind: 'signed-out' })
    expect(gate({}, { isLoading: true })).toEqual({ kind: 'checking' })
    expect(gate({}, { errorKind: 'no-wallet', isConnected: false })).toEqual({
      kind: 'no-wallet',
    })
    expect(gate({}, { errorKind: 'locked' })).toEqual({ kind: 'locked' })
    expect(gate({}, { isConnected: false, publicKey: null })).toEqual({
      kind: 'disconnected',
    })
    expect(
      gate(
        {},
        {
          networkPassphrase: 'Public Global Stellar Network ; September 2015',
        }
      )
    ).toEqual({ kind: 'wrong-network', walletNetwork: 'Mainnet' })
    // A wallet that cannot report its network is not refused here; the
    // signed envelope's passphrase is checked when it is sent.
    expect(gate({}, { networkReported: false, networkPassphrase: null })).toEqual(
      { kind: 'ready' }
    )
    expect(gate({ eligibility: undefined })).toEqual({ kind: 'checking' })
  })

  it('asks to confirm a wallet that is not the linked one', () => {
    expect(
      gate({ eligibility: { reason: 'ADDRESS_UNVERIFIED', tipperAddress: null } })
    ).toEqual({ kind: 'unverified', address: A })
    expect(
      gate({ eligibility: { reason: 'NO_WALLET', tipperAddress: null } })
    ).toEqual({ kind: 'unverified', address: A })
    expect(
      gate({ eligibility: { reason: null, tipperAddress: 'GOTHER' } })
    ).toEqual({ kind: 'unverified', address: A })
  })
})
