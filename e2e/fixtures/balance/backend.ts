/**
 * The balance fixture's stand-in backend, in the page and kept in
 * `localStorage`, so a reload or a new tab sees the same "server". It
 * answers the functions the payments runtime reads and calls, with the same
 * shapes and the same exactly-once rules as Convex (`convex/balance.ts`,
 * `convex/activity.ts`, `convex/earnings.ts`, `tabs.prepareTip` idempotent on
 * `requestId`, `tabs.submitTip` idempotent on the prepared tip). Tests drive
 * it through `window.__fixture`.
 */
type User = 'a' | 'b' | 'w'
type Status = 'ACCEPTED' | 'SETTLED' | 'SHORTFALL' | 'UNPAID' | 'REJECTED'

type Receipt = {
  id: string
  requestId: string
  prepareId: string
  reader: User
  amountCents: number
  base: string
  status: Status
  at: number
  passage: string | null
  signature: string
  txHash: string | null
  /** For a tip paid short: the cents of it already paid. */
  paidCents?: number
}

type Prepared = {
  prepareId: string
  requestId: string
  reader: User
  amountCents: number
  base: string
  passage: string | null
  createdAt: number
}

export type FixtureState = {
  seed: string
  user: User | null
  authLoading: boolean
  /** Queries answer `undefined` (loading) while true. */
  hold: boolean
  price: number
  accounts: Partial<Record<User, { confirmed: string }>>
  receipts: Receipt[]
  prepared: Prepared[]
  latencyMs: number
  failSubmit: string | null
  collectedCents: number
  collectedBase: string
  calls: { prepare: number; submit: number; refused: number }
  /** `balance:session` is missing on the backend, or throws. */
  sessionFault: 'missing' | 'throwing' | null
  perTipCents: number
}

const KEY = 'qt-fixture-backend'
const ADDRESS: Record<User, string> = {
  a: 'GAREADERAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  b: 'GBREADERBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  w: 'GWRITERWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW',
}
const TAB = 'CB2OJSZTDGEA2GPQ5TXXEWBVBDY4SS3XN4B46OTSNQHZNXFF4RBHTLFK'
const ARTICLE_TITLE = 'Leave It Overnight'

const listeners = new Set<() => void>()
let version = 0
let state: FixtureState = load()

function fresh(seed: string): FixtureState {
  return {
    seed,
    user: null,
    authLoading: false,
    hold: false,
    price: 0.35,
    accounts: {},
    receipts: [],
    prepared: [],
    latencyMs: 120,
    failSubmit: null,
    collectedCents: 0,
    collectedBase: '0',
    calls: { prepare: 0, submit: 0, refused: 0 },
    sessionFault: null,
    perTipCents: 500,
  }
}

function load(): FixtureState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw) as FixtureState
  } catch {
    // A fresh backend.
  }
  return fresh('none')
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Memory only.
  }
  version++
  cache.clear()
  for (const l of listeners) l()
}

window.addEventListener('storage', (event) => {
  if (event.key !== KEY) return
  state = load()
  version++
  cache.clear()
  for (const l of listeners) l()
})

export function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const getVersion = () => version
export const current = () => state

export function reset(seed: string, apply: (s: FixtureState) => void) {
  state = fresh(seed)
  apply(state)
  save()
}

export function update(apply: (s: FixtureState) => void) {
  apply(state)
  save()
}

const STROOPS = 10_000_000
const toBase = (cents: number) =>
  BigInt(Math.floor((cents * STROOPS) / (state.price * 100)))
const toCents = (base: bigint) =>
  base <= BigInt(0)
    ? 0
    : Math.floor((Number(base) * state.price * 100) / STROOPS)
const share = (cents: number) => Math.round(cents * 0.975 * 10_000) / 10_000
const reserves = (s: Status) => s === 'ACCEPTED' || s === 'SHORTFALL'

function session(user: User) {
  const base = {
    userId: `user-${user}`,
    accountAddress: ADDRESS[user],
    network: 'testnet' as const,
    wallet: { address: ADDRESS[user], verifiedAt: 1 },
    prices: [{ token: 'xlm', usd: state.price, at: Date.now() }],
    ledger: { sequence: 2_000_000, closedAt: Date.now() },
    settlement: { enabled: true, expectedWithinMs: 75_000 },
  }
  const account = state.accounts[user]
  if (!account)
    return {
      ...base,
      status: 'none' as const,
      tokens: [],
      availableCents: 0,
      pendingCents: 0,
      limits: null,
      devices: [],
      recentRequestIds: [],
      onChain: false,
    }
  const mine = state.receipts.filter((r) => r.reader === user)
  const reserved = mine
    .filter((r) => reserves(r.status))
    .reduce((sum, r) => sum + BigInt(r.base), BigInt(0))
  const free = BigInt(account.confirmed) - reserved
  const available = free > BigInt(0) ? free : BigInt(0)
  return {
    ...base,
    status: 'open' as const,
    tokens: [
      {
        token: 'xlm',
        contractId: 'CDLZ',
        confirmed: account.confirmed,
        outstanding: reserved.toString(),
        available: available.toString(),
        availableCents: toCents(available),
      },
    ],
    availableCents: toCents(available),
    pendingCents: mine
      .filter((r) => reserves(r.status))
      .reduce((sum, r) => sum + r.amountCents, 0),
    limits: {
      perTipCents: state.perTipCents,
      dailyCents: 2000,
      acceptedDay: new Date().toISOString().slice(0, 10),
      acceptedTodayCents: 0,
      minTipCents: 4,
      quickTipMaxCents: 500,
      defaultTipCents: 100,
    },
    devices: [
      {
        keyId: 0,
        publicKey: `key-${user}`,
        validUntilLedger: 3_000_000,
        revoked: false,
      },
    ],
    recentRequestIds: [...mine]
      .sort((x, y) => y.at - x.at)
      .slice(0, 20)
      .map((r) => r.requestId),
    onChain: true,
  }
}

function entry(r: Receipt, role: 'reader' | 'writer') {
  const state_ =
    r.status === 'ACCEPTED'
      ? 'accepted'
      : r.status === 'SETTLED'
        ? 'on-chain'
        : 'not-paid'
  const reason =
    r.status === 'SHORTFALL'
      ? 'shortfall'
      : r.status === 'UNPAID'
        ? 'expired'
        : r.status === 'REJECTED'
          ? 'rejected'
          : null
  const net = (
    BigInt(r.base) -
    (BigInt(r.base) * BigInt(250)) / BigInt(10_000)
  ).toString()
  return {
    id: r.id,
    requestId: r.requestId,
    role,
    counterparty:
      role === 'reader'
        ? { name: 'Ada Lovelace', username: 'ada' }
        : { name: 'A reader', username: null },
    article: {
      title: ARTICLE_TITLE,
      slug: 'leave-it-overnight',
      authorUsername: 'ada',
    },
    passage: r.passage,
    amountCents: r.amountCents,
    netCents: Math.floor(share(r.amountCents)),
    paidCents: r.status === 'SETTLED' ? r.amountCents : (r.paidCents ?? 0),
    paidNetCents: Math.floor(
      share(r.status === 'SETTLED' ? r.amountCents : (r.paidCents ?? 0))
    ),
    state: state_,
    notPaidReason: reason,
    at: r.at,
    txHash: r.txHash,
    baseUnits: { token: 'XLM', gross: r.base, net },
  }
}

function activity(user: User, role: 'reader' | 'writer') {
  const rows =
    role === 'reader'
      ? state.receipts.filter((r) => r.reader === user)
      : user === 'w'
        ? state.receipts
        : []
  return {
    page: [...rows].sort((x, y) => y.at - x.at).map((r) => entry(r, role)),
    isDone: true,
    continueCursor: '',
  }
}

function earnings() {
  const sum = (statuses: Status[]) =>
    state.receipts
      .filter((r) => statuses.includes(r.status))
      .reduce(
        (s, r) => Math.round((s + share(r.amountCents)) * 10_000) / 10_000,
        0
      )
  const count = (statuses: Status[]) =>
    state.receipts.filter((r) => statuses.includes(r.status)).length
  const settled = sum(['SETTLED'])
  const available = Math.max(
    0,
    Math.round((settled - state.collectedCents) * 10_000) / 10_000
  )
  return {
    writerAddress: ADDRESS.w,
    pendingCents: sum(['ACCEPTED']),
    availableCents: available,
    collectedCents: state.collectedCents,
    totalCents: sum(['ACCEPTED']) + available + state.collectedCents,
    onHoldCents: sum(['SHORTFALL']),
    notPaidCents: sum(['UNPAID', 'REJECTED']),
    pendingCount: count(['ACCEPTED']),
    settledCount: count(['SETTLED']),
    onHoldCount: count(['SHORTFALL']),
    notPaidCount: count(['UNPAID', 'REJECTED']),
    baseUnits: {
      token: 'XLM' as const,
      pendingAndOnHold: '0',
      available: toBase(available).toString(),
      collected: state.collectedBase,
    },
    figures: {
      tabEarnedCents: settled,
      tabCollectedCents: state.collectedCents,
      walletCents: 0,
      tabSettledBaseUnits: '0',
    },
    settlement: { enabled: true, expectedWithinMs: 75_000 },
  }
}

const cache = new Map<string, unknown>()

/** A query's answer, stable per backend version (like a subscription). */
export function query(name: string, args: Record<string, unknown>): unknown {
  if (name === 'balance:session' && state.user && state.sessionFault)
    throw new Error(
      state.sessionFault === 'missing'
        ? "[CONVEX Q(balance:session)] Server Error Could not find public function for 'balance:session'."
        : '[CONVEX Q(balance:session)] Server Error'
    )
  if (state.hold || state.authLoading) return undefined
  const key = `${name}:${JSON.stringify(args)}`
  if (cache.has(key)) return cache.get(key)
  const user = state.user
  let value: unknown = null
  switch (name) {
    case 'balance:session':
      value = user ? session(user) : null
      break
    case 'balance:tipContext':
      value = {
        tippable: user !== 'w',
        reason: user === 'w' ? 'own-article' : null,
        ownArticle: user === 'w',
      }
      break
    case 'activity:mine':
      value = user
        ? activity(user, args.role as 'reader' | 'writer')
        : { page: [], isDone: true, continueCursor: '' }
      break
    case 'earnings:mine':
      value = user ? earnings() : null
      break
    default:
      value = undefined
  }
  cache.set(key, value)
  return value
}

function refuse(code: string, message: string): never {
  state.calls.refused++
  save()
  throw Object.assign(new Error(message), { data: { code, message } })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function mutate(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  // The auth of this moment, as Convex runs a mutation.
  const user = state.user
  await wait(Math.min(state.latencyMs, 60))
  if (!user) refuse('UNAUTHENTICATED', 'Sign in first.')
  if (name === 'tabs:prepareTip') {
    state.calls.prepare++
    const requestId = args.requestId as string
    const existing = state.prepared.find((p) => p.requestId === requestId)
    if (existing && existing.reader !== user)
      refuse('INVALID_PREPARE', 'requestId belongs to another request.')
    const amountCents = args.amountCents as number
    const base = existing?.base ?? toBase(amountCents).toString()
    const s = session(user)
    if (!existing && BigInt(s.tokens[0]?.available ?? '0') < BigInt(base))
      refuse('TAB_OVER_BALANCE', 'The balance is too low.')
    const prepared: Prepared = existing ?? {
      prepareId: `prep-${requestId}`,
      requestId,
      reader: user,
      amountCents,
      base,
      passage:
        ((args.highlight as { text?: string } | null)?.text ?? null) || null,
      createdAt: Date.now(),
    }
    if (!existing) state.prepared.push(prepared)
    save()
    return {
      prepareId: prepared.prepareId,
      tabContractId: TAB,
      readerAddress: ADDRESS[user],
      writer: ADDRESS.w,
      keyId: 0,
      seq: 1,
      cumulativeBefore: '0',
      amount: prepared.base,
      receipt: {
        amount: prepared.base,
        articleId: 'aa'.repeat(32),
        clientRef: prepared.prepareId,
        contentHash: 'cc'.repeat(32),
        cumulativeAfter: prepared.base,
        highlightId: null,
        seq: 1,
      },
      leafHashes: [],
      expiresAt: prepared.createdAt + 300_000,
      existing: !!existing,
    }
  }
  if (name === 'tabs:submitTip') {
    state.calls.submit++
    save()
    await wait(state.latencyMs)
    // Checked after the wait: a sign-out during the send refuses it.
    const now = state.user
    if (!now) refuse('UNAUTHENTICATED', 'Sign in first.')
    if (state.failSubmit) refuse(state.failSubmit, 'Refused by the fixture.')
    const prepareId = args.prepareId as string
    const prepared = state.prepared.find((p) => p.prepareId === prepareId)
    if (!prepared || prepared.reader !== now)
      refuse('TAB_PREPARE_NOT_FOUND', 'Prepared tip not found.')
    const signature = args.signature as string
    const existing = state.receipts.find((r) => r.prepareId === prepareId)
    if (existing && existing.signature !== signature)
      refuse('TAB_DUPLICATE_REFERENCE', 'This tip was already accepted.')
    const receipt: Receipt = existing ?? {
      id: `receipt-${state.receipts.length + 1}`,
      requestId: prepared.requestId,
      prepareId,
      reader: now,
      amountCents: prepared.amountCents,
      base: prepared.base,
      status: 'ACCEPTED',
      at: Date.now(),
      passage: prepared.passage,
      signature,
      txHash: null,
    }
    if (!existing) state.receipts.push(receipt)
    save()
    return {
      status: 'ACCEPTED',
      receiptId: receipt.id,
      receipt: args.receipt,
      leafHashes: ['ll'.repeat(32)],
      voucher: {
        tabContractId: TAB,
        reader: ADDRESS[now],
        writer: ADDRESS.w,
        keyId: 0,
        publicKey: `key-${now}`,
        cumulative: receipt.base,
        receiptsRoot: 'rr'.repeat(32),
        signature,
        acceptor: 'acc',
        acceptanceSignature: 'accsig',
      },
      alreadyAccepted: !!existing,
    }
  }
  return null
}

export const fixtureAddress = (user: User) => ADDRESS[user]
export const fixtureTab = TAB
