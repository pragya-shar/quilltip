/**
 * Every state of the tab screens, by id: `/?state=<id>`. Each seeds the
 * stand-in backend; `device` says what this browser's key store holds at
 * load (set up by the page with the real tab library).
 */
import {
  FixtureState,
  LEDGER,
  tipLimitsFor,
  NOW,
  XLM,
  baseState,
  openTab,
  recomputeTab,
  serverKey,
  tipRow,
} from './backend'
import { FIXTURE_WRITER } from './constants'

export type View = 'home' | 'tip' | 'collect' | 'stats' | 'wallet'

export type DeviceSetup =
  | 'none'
  /** A key registered from this browser and held here. */
  | 'ready'
  /** Generated here, not registered. */
  | 'pending'
  /** Registered from this browser earlier, then cleared. */
  | 'gone'
  /** Registered from another browser. */
  | 'other'
  | 'expired'
  | 'renew'
  | 'revoked'
  | 'stopped'
  /** IndexedDB blocked (some private modes). */
  | 'storage-blocked'

export type Scenario = {
  id: string
  title: string
  view: View
  device: DeviceSetup
  seed(state: FixtureState): void
  /** A quick tip target with co-author splits. */
  splits?: boolean
  /**
   * The writer's stats panel (#552), with what `tips.getMyEarningsSummary`
   * returns for the writer (convex-test checks the summary itself).
   */
  stats?: {
    tipCount: number
    earnedStroops: string
    estimatedUsd: number
    complete?: boolean
    updating?: boolean
    source?: 'lifetime' | 'previous'
  }
}

const DAY = 17_280

function open(s: FixtureState, xlm = 20) {
  openTab(s, BigInt(xlm) * XLM)
}

function history(s: FixtureState) {
  s.tips = [
    tipRow(0, 'ACCEPTED', { acceptedAt: NOW - 20 * 60_000 }),
    tipRow(1, 'SETTLED'),
    tipRow(2, 'SHORTFALL'),
    tipRow(3, 'UNPAID'),
    tipRow(4, 'REJECTED'),
    tipRow(5, 'VOID_RESET'),
  ]
  if (s.tab)
    s.tab.confirmedBalance = (
      BigInt(s.tab.confirmedBalance) + BigInt(0)
    ).toString()
  recomputeTab(s)
  s.oldestUnsettledAt = NOW - 20 * 60_000
}

/**
 * A tab whose tips still settling exceed its balance (#617): 1 XLM in the
 * tab, 1.3 XLM settling, for example after a settlement paid outside the
 * app. Nothing more can settle until the reader tops up.
 */
function short(s: FixtureState) {
  open(s, 1)
  s.tips = [
    tipRow(0, 'ACCEPTED', {
      amount: ((BigInt(8) * XLM) / BigInt(10)).toString(),
      acceptedAt: NOW - 30 * 60_000,
    }),
    tipRow(1, 'SHORTFALL', {
      amount: ((BigInt(5) * XLM) / BigInt(10)).toString(),
    }),
    tipRow(2, 'SETTLED'),
  ]
  recomputeTab(s)
}

function writer(
  s: FixtureState,
  o: Partial<NonNullable<FixtureState['earnings']>> = {}
) {
  s.address = FIXTURE_WRITER
  s.earnings = {
    writerAddress: FIXTURE_WRITER,
    tabContractId: s.chainConfig.tabContractId,
    tokenContractId: s.chainConfig.tokenContractId,
    pairs: 3,
    settledGross: '120000000',
    fee: '3000000',
    earnedNet: '117000000',
    pendingNet: '24375000',
    collected: '78000000',
    unpaidPairs: 0,
    shortfallPairs: 0,
    shortfallNet: '0',
    settlementEnabled: true,
    oldestUnsettledAt: NOW - 2 * 3_600_000,
    settleWindowEndsSoon: false,
    ...o,
  }
  s.claimable = '39000000'
}

const S: Scenario[] = [
  // --- Reader: tab home --------------------------------------------------
  {
    id: 'home-no-tab',
    title: 'No tab yet',
    view: 'home',
    device: 'none',
    seed: () => {},
  },
  {
    id: 'home-open',
    title: 'Open tab, quick tips ready, history in every status',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      history(s)
    },
  },
  {
    id: 'home-empty-history',
    title: 'Open tab, no tips yet',
    view: 'home',
    device: 'ready',
    seed: (s) => open(s, 10),
  },
  {
    id: 'home-short',
    title: 'Open tab, tips still settling exceed the balance',
    view: 'home',
    device: 'ready',
    seed: short,
  },
  {
    id: 'wallet-short',
    title: 'Wallet tip history and receipts, tab short (#643)',
    view: 'wallet',
    device: 'ready',
    seed: short,
  },
  {
    id: 'wallet-short-tab-loading',
    title: 'Wallet tip history, tab short, tab still loading (#643)',
    view: 'wallet',
    device: 'ready',
    seed: (s) => {
      short(s)
      s.tabPending = true
    },
  },
  {
    id: 'wallet-zero',
    title: 'Wallet tip history, tab holds exactly what its tips need (#643)',
    view: 'wallet',
    device: 'ready',
    seed: (s) => {
      // 0.8 XLM in the tab, 0.8 XLM settling: available is exactly 0.
      openTab(s, (BigInt(8) * XLM) / BigInt(10))
      s.tips = [
        tipRow(0, 'ACCEPTED', {
          amount: ((BigInt(8) * XLM) / BigInt(10)).toString(),
          acceptedAt: NOW - 30 * 60_000,
        }),
        tipRow(2, 'SETTLED'),
      ]
      recomputeTab(s)
    },
  },
  {
    id: 'wallet-funded',
    title: 'Wallet tip history and receipts, tab covers its tips (#643)',
    view: 'wallet',
    device: 'ready',
    seed: (s) => {
      open(s, 10)
      s.tips = [
        tipRow(0, 'ACCEPTED', { acceptedAt: NOW - 30 * 60_000 }),
        tipRow(2, 'SETTLED'),
      ]
      recomputeTab(s)
    },
  },
  {
    id: 'home-loading',
    title: 'Loading',
    view: 'home',
    device: 'none',
    seed: (s) => {
      s.scenario = 'home-loading'
    },
  },
  {
    id: 'home-signed-out',
    title: 'Signed out',
    view: 'home',
    device: 'none',
    seed: (s) => {
      s.gate = 'signed-out'
      s.address = null
    },
  },
  {
    id: 'home-unverified',
    title: 'Wallet not verified',
    view: 'home',
    device: 'none',
    seed: (s) => {
      s.gate = 'unverified'
      s.address = null
    },
  },
  {
    id: 'home-no-wallet',
    title: 'No wallet installed',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.gate = 'no-wallet'
    },
  },
  {
    id: 'home-disconnected',
    title: 'Wallet not connected',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.gate = 'disconnected'
    },
  },
  {
    id: 'home-locked',
    title: 'Wallet locked',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.gate = 'locked'
    },
  },
  {
    id: 'home-other-account',
    title: 'Wallet on another account than the linked one',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      history(s)
      s.gate = 'other-account'
    },
  },
  {
    id: 'home-wrong-network',
    title: 'Wallet on another network',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.gate = 'wrong-network'
    },
  },
  {
    id: 'home-v2-disabled',
    title: 'Payments v2 off',
    view: 'home',
    device: 'none',
    seed: (s) => {
      s.chainConfig = { ...s.chainConfig, v2Enabled: false }
    },
  },
  {
    id: 'home-paused',
    title: 'Tab contract paused',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.chainConfig = { ...s.chainConfig, paused: { tab: true } }
    },
  },
  {
    id: 'home-settlement-delayed',
    title: 'Settlement delayed',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tips = [tipRow(0, 'ACCEPTED', { acceptedAt: NOW - 9 * 3_600_000 })]
      recomputeTab(s)
    },
  },
  {
    id: 'home-settle-window',
    title: 'Settle window ends within 2 days',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tips = [tipRow(0, 'ACCEPTED', { acceptedAt: NOW - 30 * 60_000 })]
      recomputeTab(s)
      s.settleWindowEndsSoon = true
    },
  },
  {
    id: 'home-settlement-off',
    title: 'Settlement not enabled',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settlementEnabled = false
      s.tips = [tipRow(0, 'ACCEPTED', { acceptedAt: NOW - 30 * 60_000 })]
      recomputeTab(s)
    },
  },
  {
    id: 'home-not-ready',
    title: 'Settlement on, keys not ready, a tip waiting',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tabReady = false
      s.tips = [tipRow(0, 'ACCEPTED', { acceptedAt: NOW - 30 * 60_000 })]
      recomputeTab(s)
    },
  },
  {
    id: 'home-settlement-off-none',
    title: 'Settlement off, no tab yet',
    view: 'home',
    device: 'none',
    seed: (s) => {
      s.settlementEnabled = false
    },
  },
  {
    id: 'home-settlement-off-open',
    title: 'Settlement off, tab open, nothing waiting',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settlementEnabled = false
    },
  },
  {
    id: 'home-closing',
    title: 'Closing: waiting for the unlock',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s, 12)
      s.tab!.status = 'CLOSING'
      s.tab!.withdrawUnlockLedger = LEDGER + 2 * DAY
    },
  },
  {
    // The estimated day has passed, the unlock ledger has not: the latest
    // ledger read is two days old (#671).
    id: 'home-closing-overdue',
    title: 'Closing: the estimate has passed, the ledger has not',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s, 12)
      s.tab!.status = 'CLOSING'
      s.tab!.withdrawUnlockLedger = LEDGER + 10
      s.clockLagMs = 2 * 86_400_000
    },
  },
  {
    id: 'home-withdraw-ready',
    title: 'Closing: withdrawal ready',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s, 12)
      s.tab!.status = 'CLOSING'
      s.tab!.withdrawUnlockLedger = LEDGER - 10
    },
  },
  {
    id: 'home-closed',
    title: 'Tab closed',
    view: 'home',
    device: 'none',
    seed: (s) => {
      openTab(s, BigInt(0))
      s.tab!.status = 'CLOSED'
    },
  },
  {
    id: 'home-worst',
    title: 'Worst case: long titles and names, extreme amounts, many keys',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      // 999.9999999 XLM: one stroop under the Tab contract's max_balance.
      openTab(s, BigInt('9999999999'), [
        serverKey(7, 'ab'.repeat(32), {
          spent: BigInt('499999999'),
          limit: BigInt('500000000'),
        }),
        serverKey(8, 'cd'.repeat(32)),
        serverKey(9, 'ef'.repeat(32), { validUntil: LEDGER + 10 }),
      ])
      s.tips = Array.from({ length: 20 }, (_, i) =>
        tipRow(
          i,
          (
            [
              'ACCEPTED',
              'SETTLED',
              'SHORTFALL',
              'UNPAID',
              'REJECTED',
              'VOID_RESET',
            ] as const
          )[i % 6]!,
          {
            amount: i % 2 ? '1' : '499999999',
            articleTitle:
              i % 3 === 0
                ? 'Notes from Przemyśl–Lwów: what a fourteen-hour night train teaches about attention, patience, and the economics of the timetable'
                : i % 3 === 1
                  ? 'Ψ'
                  : 'Über die Unverzichtbarkeitserklärungsverfahrensbestimmungen',
            authorName:
              i % 2
                ? 'Aleksandra Wiśniewska-Kowalczyk von Hohenzollern-Sigmaringen'
                : 'Jo',
            authorUsername:
              i % 4 === 0 ? null : 'aleksandra-wisniewska-kowalczyk',
          }
        )
      )
      recomputeTab(s)
    },
  },
  // --- Reader: device key -----------------------------------------------
  {
    id: 'key-none',
    title: 'Tab open, no key on this device',
    view: 'home',
    device: 'none',
    seed: (s) => open(s),
  },
  {
    id: 'key-pending',
    title: 'Key setup not finished',
    view: 'home',
    device: 'pending',
    seed: (s) => open(s),
  },
  {
    id: 'key-gone',
    title: 'Key gone from this browser',
    view: 'home',
    device: 'gone',
    seed: (s) => open(s),
  },
  {
    id: 'key-other-device',
    title: 'Key registered on another device',
    view: 'home',
    device: 'other',
    seed: (s) => open(s),
  },
  {
    id: 'key-expired',
    title: 'Key expired',
    view: 'home',
    device: 'expired',
    seed: (s) => open(s),
  },
  {
    id: 'key-renew',
    title: 'Key expires soon: renew',
    view: 'home',
    device: 'renew',
    seed: (s) => open(s),
  },
  {
    id: 'key-revoked',
    title: 'Key revoked',
    view: 'home',
    device: 'revoked',
    seed: (s) => open(s),
  },
  {
    id: 'key-stopped',
    title: 'Key stopped after a ledger mismatch',
    view: 'home',
    device: 'stopped',
    seed: (s) => open(s),
  },
  {
    id: 'key-unchecked',
    title: 'Key expiry cannot be checked (RPC unreachable)',
    view: 'home',
    device: 'expired',
    seed: (s) => {
      open(s)
      s.rpcDown = true
    },
  },
  {
    id: 'key-storage',
    title: 'Browser storage blocked',
    view: 'home',
    device: 'storage-blocked',
    seed: (s) => open(s),
  },
  // --- Reader: wallet operations (driven by the spec) --------------------
  {
    id: 'op-pending-simulating',
    title: 'Top-up: checking the details',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'hang-simulating'
    },
  },
  {
    id: 'op-pending-signing',
    title: 'Top-up: waiting for the wallet',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'hang-signing'
    },
  },
  {
    id: 'op-pending-sending',
    title: 'Top-up: sending',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'hang-sending'
    },
  },
  {
    id: 'op-checking',
    title: 'Top-up: waiting for confirmation',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.indexDelayMs = -1
      s.poll = 'hang'
    },
  },
  {
    id: 'op-confirmed',
    title: 'Top-up confirmed',
    view: 'home',
    device: 'ready',
    seed: (s) => open(s),
  },
  {
    id: 'op-declined',
    title: 'Wallet refusal',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'declined'
    },
  },
  {
    id: 'op-wrong-account',
    title: 'The wallet signed with another account',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'wrong-account'
    },
  },
  {
    id: 'op-send-error',
    title: 'Send error',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'send-error'
    },
  },
  {
    id: 'op-busy',
    title: 'Network busy',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'busy'
    },
  },
  {
    id: 'op-expired',
    title: 'Timed out',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.indexDelayMs = -1
      s.poll = 'timeout'
    },
  },
  {
    id: 'op-failed',
    title: 'Failed on chain',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.indexDelayMs = -1
      s.poll = 'failed'
    },
  },
  {
    id: 'op-wallet-balance',
    title: 'Not enough XLM in the wallet',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'balance'
    },
  },
  {
    id: 'op-locked',
    title: 'Wallet locked while signing',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'locked'
    },
  },
  {
    id: 'op-paused',
    title: 'Paused at simulation',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.send = 'paused'
    },
  },
  {
    id: 'op-low-funds',
    title: 'Wallet can spend less than asked',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.funds = {
        balance: '60000000',
        reserve: '15000000',
        spendable: '45000000',
      }
    },
  },
  {
    id: 'op-wallet-short',
    title: 'Wallet can spend less than the minimum deposit',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.funds = {
        balance: '20000000',
        reserve: '15000000',
        spendable: '5000000',
      }
    },
  },
  {
    id: 'op-tab-full',
    title: 'Tab has less room than the minimum deposit',
    view: 'home',
    device: 'ready',
    // 999.5 XLM of the 1,000 XLM cap: 0.5 XLM of room, below the 1 XLM minimum.
    seed: (s) => openTab(s, BigInt('9995000000')),
  },
  {
    id: 'op-reload',
    title: 'Reload in the middle of a top-up',
    view: 'home',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.indexDelayMs = 8_000
    },
  },
  {
    id: 'op-opening',
    title: 'Opening a tab: sent, first events not indexed yet',
    view: 'home',
    device: 'none',
    seed: (s) => {
      s.indexDelayMs = 3_000
    },
  },
  // --- Reader: quick tip --------------------------------------------------
  {
    id: 'tip-ready',
    title: 'Quick tip: ready',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settleAs = 'SETTLED'
    },
  },
  {
    id: 'tip-accepted',
    title: 'Quick tip: accepted, settling',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settleAs = null
    },
  },
  {
    id: 'tip-shortfall',
    title: 'Quick tip: waiting for balance',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settleAs = 'SHORTFALL'
    },
  },
  {
    id: 'tip-unpaid',
    title: 'Quick tip: not paid',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settleAs = 'UNPAID'
    },
  },
  {
    id: 'tip-rejected',
    title: 'Quick tip: not settled',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settleAs = 'REJECTED'
    },
  },
  {
    id: 'tip-void',
    title: 'Quick tip: cleared by reset',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settleAs = 'VOID_RESET'
    },
  },
  {
    id: 'tip-lost-response',
    title: 'Quick tip: lost response, resubmitted',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.loseSubmits = 1
      s.settleAs = null
    },
  },
  {
    id: 'tip-stale',
    title: 'Quick tip: stale, retried once',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.submitRefusal = { code: 'TAB_STALE_PREPARE', times: 1 }
    },
  },
  {
    id: 'tip-over-balance',
    title: 'Quick tip: not enough in the tab',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s, 1)
    },
  },
  {
    id: 'tip-short',
    title: 'Quick tip: the tab is short',
    view: 'tip',
    device: 'ready',
    seed: short,
  },
  {
    id: 'tip-key-limit',
    title: 'Quick tip: key limit',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.prepareRefusal.tip = 'TAB_OVER_KEY_LIMIT'
    },
  },
  {
    id: 'tip-daily-limit',
    title: 'Quick tip: daily limit',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.prepareRefusal.tip = 'TAB_DAILY_LIMIT'
    },
  },
  {
    id: 'tip-receipt-cap',
    title: 'Quick tip: receipt cap',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.prepareRefusal.tip = 'TAB_RECEIPT_CAP'
    },
  },
  {
    id: 'tip-above-max',
    title: 'Quick tip: above the maximum',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.prepareRefusal.tip = 'TAB_ABOVE_TIP_MAX'
    },
  },
  {
    id: 'tip-splits',
    title: 'Quick tip: article with co-authors',
    view: 'tip',
    device: 'ready',
    splits: true,
    seed: (s) => open(s),
  },
  {
    id: 'tip-no-tab',
    title: 'Quick tip: no tab',
    view: 'tip',
    device: 'none',
    seed: () => {},
  },
  {
    id: 'tip-closing',
    title: 'Quick tip: tab closing',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tab!.status = 'CLOSING'
      s.tab!.withdrawUnlockLedger = LEDGER + DAY
    },
  },
  {
    id: 'tip-key-none',
    title: 'Quick tip: no key here',
    view: 'tip',
    device: 'none',
    seed: (s) => open(s),
  },
  {
    id: 'tip-key-other-device',
    title: 'Quick tip: key on another device',
    view: 'tip',
    device: 'other',
    seed: (s) => open(s),
  },
  {
    id: 'tip-key-storage',
    title: 'Quick tip: browser storage blocked',
    view: 'tip',
    device: 'storage-blocked',
    seed: (s) => open(s),
  },
  {
    id: 'tip-key-stopped',
    title: 'Quick tip: key stopped',
    view: 'tip',
    device: 'stopped',
    seed: (s) => open(s),
  },
  {
    id: 'tip-key-pending',
    title: 'Quick tip: key setup not finished',
    view: 'tip',
    device: 'pending',
    seed: (s) => open(s),
  },
  {
    id: 'tip-key-revoked',
    title: 'Quick tip: key revoked',
    view: 'tip',
    device: 'revoked',
    seed: (s) => open(s),
  },
  {
    id: 'tip-key-unchecked',
    title: 'Quick tip: key expiry cannot be checked',
    view: 'tip',
    device: 'expired',
    seed: (s) => {
      open(s)
      s.rpcDown = true
    },
  },
  {
    id: 'tip-settlement-off-no-tab',
    title: 'Quick tip: settlement off, no tab',
    view: 'tip',
    device: 'none',
    seed: (s) => {
      s.settlementEnabled = false
    },
  },
  {
    id: 'tip-key-gone',
    title: 'Quick tip: key gone',
    view: 'tip',
    device: 'gone',
    seed: (s) => open(s),
  },
  {
    id: 'tip-key-expired',
    title: 'Quick tip: key expired',
    view: 'tip',
    device: 'expired',
    seed: (s) => open(s),
  },
  {
    id: 'tip-settlement-off',
    title: 'Quick tip: settlement off',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settlementEnabled = false
    },
  },
  {
    id: 'tip-not-ready',
    title: 'Quick tip: settlement on, keys not ready',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tabReady = false
    },
  },
  {
    id: 'tip-signed-out',
    title: 'Quick tip: signed out',
    view: 'tip',
    device: 'none',
    seed: (s) => {
      s.gate = 'signed-out'
      s.address = null
    },
  },
  {
    id: 'tip-v2-disabled',
    title: 'Quick tip: v2 off',
    view: 'tip',
    device: 'none',
    seed: (s) => {
      s.chainConfig = { ...s.chainConfig, v2Enabled: false }
    },
  },
  {
    id: 'tip-two-tabs',
    title: 'Quick tip: two browser tabs at once',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.settleAs = null
    },
  },
  // --- Reader: the tip dialog's tab section (#546, page /dialog) ----------
  // The dialog page also runs the tip-* states above.
  {
    id: 'dialog-loading',
    title: 'Tip dialog: the tab is loading',
    view: 'tip',
    device: 'none',
    seed: (s) => {
      s.scenario = 'home-loading'
    },
  },
  {
    id: 'dialog-tiny-balance',
    title: 'Tip dialog: one stroop free',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      openTab(s, BigInt(1))
      s.tab!.tipLimits = tipLimitsFor()
    },
  },
  {
    id: 'dialog-large-balance',
    title: 'Tip dialog: a very large free balance',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      openTab(s, BigInt('123456789012345678'))
      s.settleAs = null
    },
  },
  {
    id: 'dialog-low-max',
    title: 'Tip dialog: a 2.5 XLM tab tip maximum',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tab!.tipLimits = tipLimitsFor({ tipMax: '25000000' })
    },
  },
  {
    // A maximum of whole dollars: $4, never "$4.00" (#676).
    id: 'dialog-whole-max',
    title: 'Tip dialog: a 40 XLM tab tip maximum, $4 at the price',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tab!.tipLimits = tipLimitsFor({ tipMax: '400000000' })
    },
  },
  {
    id: 'dialog-no-price',
    title: 'Tip dialog: no current XLM price',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.tab!.tipLimits = tipLimitsFor({ priceUsd: null })
    },
  },
  {
    id: 'dialog-daily-left',
    title: 'Tip dialog: 0.5 XLM left today',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      // 19.5 of 20 XLM accepted today (UTC): 0.5 XLM left.
      s.tab!.tipLimits = tipLimitsFor({ acceptedToday: '195000000' })
    },
  },
  {
    id: 'dialog-key-limit',
    title: 'Tip dialog: 0.5 XLM left on this device',
    view: 'tip',
    device: 'ready',
    seed: (s) => {
      open(s)
      s.keySpendLimit = BigInt(5_000_000)
    },
  },
  // --- Writer: collect ----------------------------------------------------
  {
    id: 'collect-worst',
    title: 'Collect: worst case amounts',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s, {
        settledGross: '123456789012345678',
        fee: '3086419725308641',
        earnedNet: '120370369287037037',
        pendingNet: '1',
        collected: '0',
        unpaidPairs: 1,
      })
      s.claimable = '120370369287037037'
    },
  },
  {
    // The integration writer: six wallet tips and three settled tab tips.
    id: 'stats-wallet-and-tab',
    title: 'Stats: wallet and settled tab tips',
    view: 'stats',
    device: 'none',
    stats: {
      tipCount: 9,
      earnedStroops: '1145760615',
      estimatedUsd: 14.86875,
    },
    seed: (s) => writer(s),
  },
  {
    // The integration writer while its row is rebuilt: the figures as they
    // were computed before the lifetime totals, with a note.
    id: 'stats-updating',
    title: 'Stats: totals being rebuilt',
    view: 'stats',
    device: 'none',
    stats: {
      tipCount: 6,
      earnedStroops: '1145760615',
      estimatedUsd: 13.65,
      updating: true,
      source: 'previous',
    },
    seed: (s) => writer(s),
  },
  {
    // No earnings row and more v1 tips than one read: every figure is a
    // lower bound over the same tips.
    id: 'stats-lower-bound',
    title: 'Stats: lower bounds',
    view: 'stats',
    device: 'none',
    stats: {
      tipCount: 2001,
      earnedStroops: '19509750000',
      estimatedUsd: 195.0975,
      complete: false,
      source: 'previous',
    },
    seed: (s) => writer(s),
  },
  {
    // A large settled total at full precision: every stroop shows (#676).
    id: 'stats-worst',
    title: 'Stats: worst case total',
    view: 'stats',
    device: 'none',
    stats: {
      tipCount: 123456,
      earnedStroops: '1234567890123456',
      estimatedUsd: 12345678.9,
      complete: true,
      source: 'lifetime',
    },
    seed: (s) => writer(s),
  },
  {
    id: 'collect-ready',
    title: 'Collect: earnings ready',
    view: 'collect',
    device: 'none',
    seed: (s) => writer(s),
  },
  {
    id: 'collect-nothing',
    title: 'Collect: nothing to collect, tips settling',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s)
      s.claimable = '0'
    },
  },
  {
    id: 'collect-none',
    title: 'Collect: no tab earnings yet',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s, {
        pairs: 0,
        settledGross: '0',
        fee: '0',
        earnedNet: '0',
        pendingNet: '0',
        collected: '0',
        oldestUnsettledAt: null,
      })
      s.claimable = '0'
    },
  },
  {
    id: 'collect-delayed',
    title: 'Collect: settlement delayed',
    view: 'collect',
    device: 'none',
    seed: (s) => writer(s, { oldestUnsettledAt: NOW - 10 * 3_600_000 }),
  },
  {
    id: 'collect-settlement-off',
    title: 'Collect: settlement off',
    view: 'collect',
    device: 'none',
    seed: (s) => writer(s, { settlementEnabled: false }),
  },
  {
    id: 'collect-shortfall',
    title: 'Writer: tips waiting on a reader top-up',
    view: 'collect',
    device: 'none',
    seed: (s) => writer(s, { shortfallPairs: 1, shortfallNet: '4875000' }),
  },
  {
    id: 'collect-unpaid',
    title: 'Collect: a reader’s tips were not paid',
    view: 'collect',
    device: 'none',
    seed: (s) => writer(s, { unpaidPairs: 1 }),
  },
  {
    id: 'collect-unverified',
    title: 'Collect: wallet not verified',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s)
      s.address = null
      s.earnings = null
      s.gate = 'unverified'
    },
  },
  {
    id: 'collect-disconnected',
    title: 'Collect: wallet not connected',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s)
      s.gate = 'disconnected'
    },
  },
  {
    id: 'collect-declined',
    title: 'Collect: wallet refusal',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s)
      s.send = 'declined'
    },
  },
  {
    id: 'collect-checking',
    title: 'Collect: waiting for confirmation',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s)
      s.indexDelayMs = -1
      s.poll = 'hang'
    },
  },
  {
    id: 'collect-paused',
    title: 'Collect: allowed while paused',
    view: 'collect',
    device: 'none',
    seed: (s) => {
      writer(s)
      s.chainConfig = { ...s.chainConfig, paused: { tab: true } }
    },
  },
]

export const SCENARIOS: ReadonlyMap<string, Scenario> = new Map(
  S.map((s) => [s.id, s])
)

export function seedScenario(id: string): FixtureState {
  const scenario = SCENARIOS.get(id)
  const state = baseState(id)
  scenario?.seed(state)
  return state
}

export { serverKey }
