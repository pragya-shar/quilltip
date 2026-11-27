/** Seeds and test controls for the balance fixture backend. */
import * as backend from './backend'
import type { FixtureState } from './backend'

const MIN = 60_000
const XLM = (n: number) => String(Math.round(n * 10_000_000))

function receipt(
  s: FixtureState,
  o: {
    reader?: 'a' | 'b'
    cents: number
    status: FixtureState['receipts'][number]['status']
    ago?: number
    passage?: string | null
    tx?: boolean
    paidCents?: number
  }
) {
  const n = s.receipts.length + 1
  const base = String(Math.floor((o.cents * 10_000_000) / (s.price * 100)))
  s.receipts.push({
    id: `receipt-${n}`,
    requestId: `seed-${n}`,
    prepareId: `prep-seed-${n}`,
    reader: o.reader ?? 'a',
    amountCents: o.cents,
    base,
    status: o.status,
    at: Date.now() - (o.ago ?? 0),
    passage:
      o.passage === undefined
        ? 'Leave it overnight. The work does not go anywhere.'
        : o.passage,
    signature: `sig-seed-${n}`,
    txHash: o.tx ? 'ab'.repeat(32) : null,
    ...(o.paidCents !== undefined ? { paidCents: o.paidCents } : {}),
  })
}

export const SCENARIOS: Record<string, (s: FixtureState) => void> = {
  'reader-ready': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
  },
  'reader-low': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(0.5) }
  },
  'reader-broke': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(0.2) }
  },
  'reader-capped': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
    s.perTipCents = 63
  },
  'signed-out': (s) => {
    s.accounts.a = { confirmed: XLM(20) }
  },
  'reader-slow': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
    s.latencyMs = 4_000
  },
  'reader-refused': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
    s.failSubmit = 'TAB_STALE_PREPARE'
  },
  'reader-history': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
    receipt(s, { cents: 300, status: 'UNPAID', ago: 3 * 60 * MIN })
    receipt(s, { cents: 100, status: 'SHORTFALL', ago: 2 * 60 * MIN })
    receipt(s, { cents: 200, status: 'SETTLED', ago: 60 * MIN, tx: true })
    receipt(s, { cents: 100, status: 'ACCEPTED', ago: 2 * MIN, passage: null })
  },
  'reader-empty': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
  },
  'reader-none': (s) => {
    s.user = 'a'
  },
  'reader-device': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
  },
  loading: (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
    s.hold = true
  },
  'writer-pending': (s) => {
    s.user = 'w'
    receipt(s, { cents: 100, status: 'ACCEPTED', ago: 20_000 })
    receipt(s, { cents: 300, status: 'ACCEPTED', ago: 5_000, reader: 'b' })
  },
  'writer-lagging': (s) => {
    s.user = 'w'
    receipt(s, { cents: 100, status: 'ACCEPTED', ago: 14 * MIN })
  },
  'writer-available': (s) => {
    s.user = 'w'
    receipt(s, { cents: 200, status: 'SETTLED', ago: 30 * MIN, tx: true })
    receipt(s, { cents: 100, status: 'SETTLED', ago: 20 * MIN, tx: true })
    receipt(s, { cents: 100, status: 'ACCEPTED', ago: 10_000 })
  },
  'writer-collected': (s) => {
    s.user = 'w'
    receipt(s, { cents: 200, status: 'SETTLED', ago: 30 * MIN, tx: true })
    receipt(s, { cents: 100, status: 'SETTLED', ago: 20 * MIN, tx: true })
    s.collectedCents = 195
    s.collectedBase = String(Math.floor((195 * 10_000_000) / (s.price * 100)))
  },
  'writer-failed': (s) => {
    s.user = 'w'
    receipt(s, { cents: 100, status: 'SETTLED', ago: 40 * MIN, tx: true })
    receipt(s, { cents: 300, status: 'SHORTFALL', ago: 30 * MIN })
    receipt(s, { cents: 100, status: 'UNPAID', ago: 20 * MIN })
  },
  'reader-partial': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
    receipt(s, { cents: 25, status: 'SHORTFALL', ago: 20 * MIN, paidCents: 10 })
    receipt(s, { cents: 25, status: 'UNPAID', ago: 10 * MIN, paidCents: 10 })
  },
  'writer-partial': (s) => {
    s.user = 'w'
    receipt(s, { cents: 25, status: 'SHORTFALL', ago: 20 * MIN, paidCents: 10 })
    receipt(s, { cents: 25, status: 'UNPAID', ago: 10 * MIN, paidCents: 10 })
  },
  'writer-empty': (s) => {
    s.user = 'w'
  },
  'two-readers': (s) => {
    s.user = 'a'
    s.accounts.a = { confirmed: XLM(20) }
    s.accounts.b = { confirmed: XLM(10) }
  },
}

/** `window.__fixture`: what a test can do to the "server". */
export const controls = {
  state: () => backend.current(),
  signIn: (user: 'a' | 'b' | 'w') =>
    backend.update((s) => void (s.user = user)),
  signOut: () => backend.update((s) => void (s.user = null)),
  latency: (ms: number) => backend.update((s) => void (s.latencyMs = ms)),
  failSubmit: (code: string | null) =>
    backend.update((s) => void (s.failSubmit = code)),
  sessionFault: (fault: 'missing' | 'throwing' | null) =>
    backend.update((s) => void (s.sessionFault = fault)),
  settleAll: () =>
    backend.update((s) => {
      for (const r of s.receipts)
        if (r.status === 'ACCEPTED' || r.status === 'SHORTFALL') {
          r.status = 'SETTLED'
          r.txHash = 'cd'.repeat(32)
        }
    }),
  shortfall: () =>
    backend.update((s) => {
      for (const r of s.receipts)
        if (r.status === 'ACCEPTED') r.status = 'SHORTFALL'
    }),
  unpaid: () =>
    backend.update((s) => {
      for (const r of s.receipts)
        if (r.status === 'ACCEPTED' || r.status === 'SHORTFALL')
          r.status = 'UNPAID'
    }),
}
