import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  CHAIN_RECORD_STATUSES,
  TAB_RECEIPT_STATUSES,
  type ChainRecordStatus,
  type TabReceiptStatus,
} from '../../convex/lib/chain/schema'
import {
  CHECKING_SLOW,
  ESTIMATE,
  estimateXlmCopy,
  FAILURE_COPY,
  FLOW_COPY,
  GATE_BUSY,
  NOTICE_ACTION,
  NOTICE_COPY,
  PROGRESS_HEADING,
  RESULT_COPY,
  RESUMING_COPY,
  SESSION_KEY_COPY,
  SIGNING_HELP,
  STATUS_LABEL,
  STEP_COPY,
  STEP_LABEL,
  TAB_OPERATION_RESULT,
  TAB_REFUSAL_COPY,
  TAB_TIP_RESULT,
  TAB_TIP_SENDING,
  TESTNET_LABEL,
  TESTNET_LABEL_DETAIL,
  WALLET_FAILURE_COPY,
  WRONG_ACCOUNT_AFTER_SIGNING,
  basketConfirmed,
  gateCopy,
  quoteCopy,
  tabCloseConfirmed,
  CANCEL_LABEL,
  DONE_LABEL,
  HELP_LABEL,
  REFERENCE_LABEL,
  RETRY_LABEL,
  VIEW_TRANSACTION,
} from '../../lib/copy/payment-states'
import { TIPS_UNAVAILABLE_COPY } from '../../lib/copy/tips-unavailable'
import * as kitCopyModule from '../../lib/copy/payment-states'
import * as tabCopyModule from '../../lib/copy/tab'
import {
  coreTipSplit,
  estimateLedgerTime,
  explorerTxUrl,
  formatCentsQuote,
  formatDay,
  formatXlm,
  roundXlmEstimate,
  shortAddress,
} from '../../lib/payments/format'
import {
  TAB_REFUSAL_CODES,
  failureFromContract,
  failureFromWalletError,
  gateFromWalletError,
  noticeFromContractFailure,
  refusalFromTabError,
  viewFromTxOutcome,
  walletNetworkLabel,
} from '../../lib/payments/failures'
import {
  PAYMENT_FLOWS,
  SETTLEMENT_DELAYED_AFTER_MS,
  deriveProgress,
  isSettlementDelayed,
  phaseFromBatch,
  phaseFromRecord,
  phaseFromTabOperation,
  phaseAllowsRetry,
  phaseFromTabTip,
  recordAllowsRetry,
  resolvePaymentView,
  type PaymentPhase,
  type TabSnapshot,
} from '../../lib/payments/ui-state'
import {
  describeContractFailure,
  raisingContract,
} from '../../lib/stellar/v2/errors'
import {
  networkLabel,
  type WalletErrorKind,
} from '../../lib/stellar/v2/wallet-errors'

const ROOT = path.join(__dirname, '../..')
const ALL_PHASES = Object.keys(STATUS_LABEL) as PaymentPhase[]
const TESTNET = 'Test SDF Network ; September 2015'
const PUBLIC = 'Public Global Stellar Network ; September 2015'
const CORE = 'CC7Q3HDXQHMSI2WUE6C2KC35TRLPL22T3WEGZ67AB7KK5PDDJHQPZMZY'
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC'
const READY = { kind: 'ready' } as const

function errorEvent(contractId: string, code: number) {
  return {
    event: {
      contract_id: contractId,
      body: {
        v0: { topics: [{ symbol: 'error' }, { error: { contract: code } }] },
      },
    },
  }
}

describe('server status to phase', () => {
  test('maps every chain record status', () => {
    const expected: Record<ChainRecordStatus, PaymentPhase> = {
      PREPARED: 'resuming',
      SUBMITTED: 'checking',
      CONFIRMED: 'confirmed',
      MISMATCH: 'under-review',
      FAILED: 'failed',
      EXPIRED: 'expired',
    }
    for (const status of CHAIN_RECORD_STATUSES) {
      expect(phaseFromRecord({ status })).toBe(expected[status])
    }
  })

  test('an unknown status is safe: resuming, no retry, never confirmed', () => {
    for (const status of [
      'PENDING',
      'CONFIRMING',
      'FRAUDULENT',
      '',
      'confirmed',
    ]) {
      const view = deriveProgress({ record: { status } })
      expect(view.phase).toBe('resuming')
      expect(view.retry).toBe(false)
    }
  })

  test('an author mismatch is a completed payment to the registered address', () => {
    expect(
      phaseFromRecord({ status: 'MISMATCH', mismatchReason: 'author' })
    ).toBe('sent-to-registered')
    for (const reason of [
      'field:gross',
      'field:ledger',
      'no_event',
      null,
      'AUTHOR',
    ]) {
      expect(
        phaseFromRecord({ status: 'MISMATCH', mismatchReason: reason })
      ).toBe('under-review')
    }
  })

  test('a live client step shows only while the record is PREPARED', () => {
    expect(phaseFromRecord({ status: 'PREPARED' }, { step: 'signing' })).toBe(
      'signing'
    )
    expect(phaseFromRecord({ status: 'SUBMITTED' }, { step: 'signing' })).toBe(
      'checking'
    )
    expect(phaseFromRecord({ status: 'CONFIRMED' }, { step: 'sending' })).toBe(
      'confirmed'
    )
    expect(phaseFromRecord({ status: 'FAILED' }, { step: 'simulating' })).toBe(
      'failed'
    )
  })

  test('a failed or expired record flagged for review is under review', () => {
    // The server sets needsReview when an event arrives after the failure:
    // the payment may have landed (tipUiState maps it to mismatch_review).
    for (const status of ['FAILED', 'EXPIRED']) {
      const view = deriveProgress({
        record: { status, needsReview: true },
        declined: true,
      })
      expect(view).toMatchObject({ phase: 'under-review', retry: false })
    }
    expect(phaseFromRecord({ status: 'FAILED', needsReview: false })).toBe(
      'failed'
    )
  })

  test('a reloaded PREPARED record claims no step as done', () => {
    expect(phaseFromRecord({ status: 'PREPARED' })).toBe('resuming')
    expect(phaseFromRecord({ status: 'PREPARED' }, { step: null })).toBe(
      'resuming'
    )
  })

  test('maps every tab tip status', () => {
    const expected: Record<TabReceiptStatus, PaymentPhase> = {
      ACCEPTED: 'accepted',
      SETTLED: 'settled',
      SHORTFALL: 'shortfall',
      UNPAID: 'unpaid',
      REJECTED: 'rejected',
      VOID_RESET: 'void-reset',
    }
    for (const status of TAB_RECEIPT_STATUSES) {
      expect(phaseFromTabTip(status)).toBe(expected[status])
    }
    expect(phaseFromTabTip('PREPARED')).toBe('resuming')
    expect(deriveProgress({ tabTip: { status: 'NEW' } })).toEqual({
      phase: 'resuming',
      retry: false,
      redirected: 0,
    })
  })
})

describe('wallet refusal, as the server records it', () => {
  test('declined shows at once and allows retry only after FAILED is recorded', () => {
    const before = deriveProgress({
      record: { status: 'PREPARED' },
      declined: true,
    })
    expect(before).toMatchObject({ phase: 'declined', retry: false })
    const after = deriveProgress({
      record: { status: 'FAILED' },
      declined: true,
    })
    expect(after).toMatchObject({ phase: 'declined', retry: true })
  })

  test('the wallet outcome is recorded as wallet_rejected', () => {
    expect(
      viewFromTxOutcome({
        status: 'wallet_failed',
        error: { kind: 'rejected' },
      })
    ).toEqual({
      show: { kind: 'declined' },
      record: { reason: 'wallet_rejected', detail: 'rejected' },
    })
    expect(RESULT_COPY.declined.detail).toBe('Nothing was signed or sent.')
  })
})

describe('retry rule', () => {
  test('only failed, expired and declined phases can retry', () => {
    const retryable = ALL_PHASES.filter(phaseAllowsRetry)
    expect(retryable.sort()).toEqual(['declined', 'expired', 'failed'])
  })

  test('the record decides: FAILED and EXPIRED, never under review', () => {
    expect(recordAllowsRetry({ status: 'FAILED' })).toBe(true)
    expect(recordAllowsRetry({ status: 'EXPIRED' })).toBe(true)
    expect(recordAllowsRetry({ status: 'FAILED', needsReview: true })).toBe(
      false
    )
    for (const status of ['PREPARED', 'SUBMITTED', 'CONFIRMED', 'MISMATCH']) {
      expect(recordAllowsRetry({ status })).toBe(false)
    }
  })

  test('no mismatch outcome can offer retry', () => {
    for (const reason of ['author', 'field:gross', 'no_event']) {
      expect(
        deriveProgress({
          record: { status: 'MISMATCH', mismatchReason: reason },
        }).retry
      ).toBe(false)
    }
  })
})

describe('batches', () => {
  test('a row under review puts the payment under review', () => {
    expect(
      phaseFromBatch({ status: 'MISMATCH', mismatchReason: 'field:amount' }, [
        { status: 'CONFIRMED' },
        { status: 'MISMATCH', mismatchReason: 'field:amount' },
      ])
    ).toEqual({ phase: 'under-review', redirected: 0 })
  })

  test('a row flagged for review puts the payment under review', () => {
    expect(
      phaseFromBatch({ status: 'FAILED' }, [
        { status: 'FAILED' },
        { status: 'FAILED', needsReview: true },
      ])
    ).toEqual({ phase: 'under-review', redirected: 0 })
  })

  test('redirected rows still confirm the payment and are counted', () => {
    const view = deriveProgress({
      record: { status: 'MISMATCH', mismatchReason: 'author' },
      rows: [
        { status: 'CONFIRMED' },
        { status: 'MISMATCH', mismatchReason: 'author' },
        { status: 'MISMATCH', mismatchReason: 'author' },
      ],
    })
    expect(view).toEqual({ phase: 'confirmed', redirected: 2, retry: false })
    expect(basketConfirmed(2).detail).toMatch(/2 went to/)
    expect(basketConfirmed(1).detail).toMatch(/One went to/)
    expect(basketConfirmed(0)).toEqual(FLOW_COPY['tip-basket'])
  })

  test('rows still pending leave the record in charge', () => {
    expect(
      phaseFromBatch({ status: 'SUBMITTED' }, [
        { status: 'CONFIRMED' },
        { status: 'SUBMITTED' },
      ]).phase
    ).toBe('checking')
    expect(phaseFromBatch({ status: 'FAILED' }, []).phase).toBe('failed')
  })
})

describe('tab operations confirm from indexed tab state', () => {
  const tab: NonNullable<TabSnapshot> = {
    status: 'OPEN',
    confirmedBalance: '200',
    keys: [
      { keyId: 'a', revoked: false },
      { keyId: 'b', revoked: true },
    ],
  }

  test('each operation confirms only when the state shows it', () => {
    expect(phaseFromTabOperation({ flow: 'tab-open' }, tab)).toBe('confirmed')
    expect(phaseFromTabOperation({ flow: 'tab-open' }, null)).toBe('resuming')
    expect(
      phaseFromTabOperation({ flow: 'tab-top-up', before: '100' }, tab)
    ).toBe('confirmed')
    expect(
      phaseFromTabOperation({ flow: 'tab-top-up', before: '200' }, tab, {
        sent: true,
      })
    ).toBe('checking')
    expect(
      phaseFromTabOperation({ flow: 'tab-new-key', keyId: 'a' }, tab)
    ).toBe('confirmed')
    expect(
      phaseFromTabOperation({ flow: 'tab-new-key', keyId: 'b' }, tab, {
        step: 'signing',
      })
    ).toBe('signing')
    expect(
      phaseFromTabOperation({ flow: 'tab-revoke-key', keyId: 'b' }, tab)
    ).toBe('confirmed')
    expect(
      phaseFromTabOperation(
        { flow: 'tab-close' },
        { ...tab, status: 'CLOSING' }
      )
    ).toBe('confirmed')
    expect(phaseFromTabOperation({ flow: 'tab-close' }, tab)).toBe('resuming')
    expect(
      phaseFromTabOperation(
        { flow: 'tab-withdraw' },
        { ...tab, status: 'CLOSED' }
      )
    ).toBe('confirmed')
  })

  test('RPC failure and a timeout allow retry; indexed state still wins', () => {
    const op = { flow: 'tab-top-up', before: '200' } as const
    expect(
      deriveProgress({ tabOperation: op, tab, sent: true, poll: 'FAILED' })
    ).toMatchObject({ phase: 'failed', retry: true })
    expect(
      deriveProgress({ tabOperation: op, tab, sent: true, poll: 'TIMEOUT' })
    ).toMatchObject({ phase: 'expired', retry: true })
    expect(
      deriveProgress({
        tabOperation: op,
        tab: { ...tab, confirmedBalance: '300' },
        poll: 'TIMEOUT',
      })
    ).toMatchObject({ phase: 'confirmed', retry: false })
    // Polling SUCCESS alone never confirms.
    expect(
      deriveProgress({ tabOperation: op, tab, sent: true, poll: 'SUCCESS' })
        .phase
    ).toBe('checking')
  })
})

describe('resolvePaymentView: one precedence rule', () => {
  const checking = { record: { status: 'SUBMITTED' } }

  test('a payment in progress always renders; conditions only sit beside it', () => {
    const paused = resolvePaymentView({
      source: checking,
      gate: { kind: 'locked' },
      notice: { kind: 'paused' },
    })
    expect(paused.progress?.phase).toBe('checking')
    expect(paused.condition).toEqual({
      kind: 'notice',
      notice: { kind: 'paused' },
    })
    expect(paused.showStart).toBe(false)

    const gated = resolvePaymentView({
      source: { record: { status: 'CONFIRMED' } },
      gate: { kind: 'wrong-network' },
    })
    expect(gated.progress?.phase).toBe('confirmed')
    expect(gated.condition?.kind).toBe('gate')
  })

  test('order without a payment: tips unavailable, paused, gate, other notice', () => {
    const all = {
      source: null,
      gate: { kind: 'locked' } as const,
      notice: { kind: 'paused' } as const,
      tipsUnavailable: 'unregistered' as const,
    }
    expect(resolvePaymentView(all).condition?.kind).toBe('tips-unavailable')
    expect(
      resolvePaymentView({ ...all, tipsUnavailable: null }).condition
    ).toEqual({ kind: 'notice', notice: { kind: 'paused' } })
    expect(
      resolvePaymentView({
        ...all,
        tipsUnavailable: null,
        notice: { kind: 'insufficient-balance' },
      }).condition?.kind
    ).toBe('gate')
    const short = resolvePaymentView({
      source: null,
      gate: READY,
      notice: { kind: 'insufficient-balance' },
    })
    expect(short.condition?.kind).toBe('notice')
    // A short balance keeps the form so the reader can choose less.
    expect(short).toMatchObject({ showStart: true, canStart: false })
  })

  test('the start form never shows beside a payment in progress or finished', () => {
    for (const source of [
      { record: { status: 'SUBMITTED' } },
      { record: { status: 'PREPARED' }, step: 'signing' as const },
      { record: { status: 'CONFIRMED' } },
      { record: { status: 'FAILED' } },
      { tabTip: { status: 'ACCEPTED' } },
    ]) {
      const view = resolvePaymentView({ source, gate: READY })
      expect(view.progress).not.toBeNull()
      expect(view.condition).toBeNull()
      expect(view.showStart).toBe(false)
      expect(view.canStart).toBe(false)
    }
  })

  test('the start form runs only with nothing in the way', () => {
    expect(resolvePaymentView({ source: null, gate: READY })).toMatchObject({
      progress: null,
      condition: null,
      showStart: true,
      canStart: true,
      canRetry: false,
    })
    expect(
      resolvePaymentView({ source: null, gate: { kind: 'signed-out' } })
    ).toMatchObject({ showStart: false, canStart: false })
  })

  test('retry waits while a condition blocks it', () => {
    const failed = { record: { status: 'FAILED' } }
    expect(resolvePaymentView({ source: failed, gate: READY }).canRetry).toBe(
      true
    )
    expect(
      resolvePaymentView({
        source: failed,
        gate: READY,
        notice: { kind: 'paused' },
      }).canRetry
    ).toBe(false)
    expect(
      resolvePaymentView({ source: failed, gate: { kind: 'locked' } }).canRetry
    ).toBe(false)
    expect(
      resolvePaymentView({
        source: { record: { status: 'MISMATCH', mismatchReason: 'no_event' } },
        gate: READY,
      }).canRetry
    ).toBe(false)
  })
})

describe('settlement delay', () => {
  test('waits past the 6 h due time and two settler runs', () => {
    const now = Date.UTC(2026, 10, 27, 12)
    const hours = (h: number) => now - h * 60 * 60 * 1000
    expect(SETTLEMENT_DELAYED_AFTER_MS).toBe(8 * 60 * 60 * 1000)
    expect(isSettlementDelayed(hours(6.2), now)).toBe(false)
    expect(isSettlementDelayed(hours(7.9), now)).toBe(false)
    expect(isSettlementDelayed(hours(8.1), now)).toBe(true)
    expect(isSettlementDelayed(null, now)).toBe(false)
  })
})

/**
 * Every wallet error kind. The type check below fails to compile when
 * `WalletErrorKind` gains a kind that is not listed here, and the test
 * below fails when a listed kind has no copy of its own.
 */
const WALLET_KINDS = [
  'no-wallet',
  'locked',
  'wrong-network',
  'rejected',
  'timeout',
  'cancelled',
  'unsupported',
  'popup-blocked',
  'disconnected',
  'wrong-account',
  'failed',
] as const satisfies readonly WalletErrorKind[]
type UnlistedWalletKind = Exclude<
  WalletErrorKind,
  (typeof WALLET_KINDS)[number]
>
const everyWalletKindListed: [UnlistedWalletKind] extends [never]
  ? true
  : false = true

describe('wallet failures', () => {
  test('every wallet error kind has its own copy or state', () => {
    expect(everyWalletKindListed).toBe(true)
    for (const kind of WALLET_KINDS) {
      const view = viewFromTxOutcome({
        status: 'wallet_failed',
        error: { kind },
      }).show
      if (kind === 'cancelled') {
        expect(view).toEqual({ kind: 'cancelled' })
        continue
      }
      // Its own entry, not the generic fallback (except for `failed`).
      expect(Object.hasOwn(WALLET_FAILURE_COPY, kind), kind).toBe(true)
      if (kind !== 'failed' && view.kind === 'failed') {
        expect(view.failure, kind).not.toEqual(WALLET_FAILURE_COPY.failed)
      }
    }
  })

  test('a blocked pop-up stays in the progress view with its next step', () => {
    expect(gateFromWalletError({ kind: 'popup-blocked' })).toBeNull()
    expect(
      viewFromTxOutcome({
        status: 'wallet_failed',
        error: { kind: 'popup-blocked' },
      })
    ).toEqual({
      show: { kind: 'failed', failure: WALLET_FAILURE_COPY['popup-blocked'] },
      record: { reason: 'wallet_rejected', detail: 'popup-blocked' },
    })
    expect(WALLET_FAILURE_COPY['popup-blocked'].detail).toMatch(
      /^Allow pop-ups for this site/
    )
  })

  test('a connection the wallet ended goes back to the gate to connect again', () => {
    expect(gateFromWalletError({ kind: 'disconnected' })).toEqual({
      kind: 'disconnected',
      ended: true,
    })
    expect(
      viewFromTxOutcome({
        status: 'wallet_failed',
        error: { kind: 'disconnected' },
      })
    ).toEqual({
      show: { kind: 'gate', gate: { kind: 'disconnected', ended: true } },
      record: { reason: 'wallet_rejected', detail: 'disconnected' },
    })
    const ended = gateCopy('disconnected', { ended: true })
    expect(ended).toEqual({
      title: 'Your wallet disconnected',
      detail:
        'Your wallet ended the connection. Connect again to continue. Nothing was sent.',
      action: 'Connect again',
    })
    // A wallet that was never connected keeps the plain connect copy.
    expect(gateCopy('disconnected').title).toBe('Connect your wallet')
  })

  test('connection failures become gate states', () => {
    expect(gateFromWalletError({ kind: 'no-wallet' })).toEqual({
      kind: 'no-wallet',
    })
    expect(gateFromWalletError({ kind: 'locked' })).toEqual({ kind: 'locked' })
    expect(
      gateFromWalletError({ kind: 'wrong-network', walletPassphrase: PUBLIC })
    ).toEqual({ kind: 'wrong-network', walletNetwork: 'Mainnet' })
  })

  test('the network label matches the wallet adapter', () => {
    for (const passphrase of [
      TESTNET,
      PUBLIC,
      'Test SDF Future Network ; October 2022',
      'Standalone Network ; February 2017',
      'Something else',
      undefined,
    ]) {
      expect(walletNetworkLabel(passphrase)).toBe(networkLabel(passphrase))
    }
  })

  test('signing failures stay in the progress view with fixed titles', () => {
    for (const kind of [
      'rejected',
      'timeout',
      'wrong-account',
      'unsupported',
      'failed',
      'cancelled',
    ] as const) {
      expect(gateFromWalletError({ kind })).toBeNull()
    }
    expect(failureFromWalletError({ kind: 'rejected' })).toEqual(
      RESULT_COPY.declined
    )
    expect(failureFromWalletError({ kind: 'cancelled' })).toBeNull()
    expect(failureFromWalletError({ kind: 'failed' })?.title).toBe(
      'Your wallet reported a problem'
    )
  })

  test('wrong account: before signing, after signing with the linked address, and without it (#582)', () => {
    const LINKED = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
    const OTHER = 'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
    expect(
      failureFromWalletError({
        kind: 'wrong-account',
        expectedAddress: LINKED,
        walletAddress: OTHER,
      })?.title
    ).toBe('Switch your wallet to GCS5…DUAR')
    expect(
      failureFromWalletError({ kind: 'wrong-account', expectedAddress: LINKED })
    ).toEqual({
      title: 'Your wallet signed with another account',
      detail:
        'Switch your wallet to GCS5…DUAR, the address linked to your Quilltip account, or reconnect. Nothing was sent.',
    })
    expect(failureFromWalletError({ kind: 'wrong-account' })?.detail).toBe(
      'Switch back to the connected account in your wallet, or reconnect. Nothing was sent.'
    )
  })
})

describe('contract failures, decoded with the raising contract', () => {
  const contracts = { core: CORE, token: TOKEN }
  const decode = (code: number, raiser: string | null) =>
    describeContractFailure(`HostError: Error(Contract, #${code})`, {
      raisedBy: raiser,
      contracts,
    })

  test('a native XLM shortfall is the not-enough-XLM notice', () => {
    const failure = describeContractFailure('HostError: Error(Contract, #10)', {
      raisedBy: raisingContract([errorEvent(TOKEN, 10), errorEvent(CORE, 10)]),
      contracts,
    })
    expect(noticeFromContractFailure(failure)).toEqual({
      kind: 'insufficient-balance',
      source: 'wallet',
    })
    expect(failureFromContract(failure).detail).not.toMatch(/already sent/)
  })

  test('a fee shortfall at send is the same notice', () => {
    expect(
      noticeFromContractFailure(
        describeContractFailure('txInsufficientBalance')
      )
    ).toEqual({ kind: 'insufficient-balance', source: 'wallet' })
  })

  test('Core codes keep their meaning; unknown raisers are plain failures', () => {
    expect(noticeFromContractFailure(decode(1000, CORE))).toEqual({
      kind: 'paused',
    })
    expect(noticeFromContractFailure(decode(1, CORE))).toEqual({
      kind: 'tips-unavailable',
      reason: 'unregistered',
    })
    expect(noticeFromContractFailure(decode(1, CORE), { batch: true })).toEqual(
      { kind: 'basket-item-unavailable' }
    )
    // Core #10 is a duplicate tip, not a balance problem.
    expect(noticeFromContractFailure(decode(10, CORE))).toBeNull()
    for (const raiser of [null, 'CBOTHER']) {
      const failure = decode(10, raiser)
      expect(noticeFromContractFailure(failure)).toBeNull()
      expect(failureFromContract(failure)).toEqual({
        title: 'Not sent',
        detail: 'Stellar testnet refused the transaction. Nothing was sent.',
      })
    }
  })

  test('tab codes become their notices only when the tab raised them', () => {
    const tabContracts = { tab: 'CTAB' }
    const tab = (code: number, raiser: string) =>
      describeContractFailure(`Error(Contract, #${code})`, {
        raisedBy: raiser,
        contracts: tabContracts,
      })
    expect(noticeFromContractFailure(tab(35, 'CTAB'))).toEqual({
      kind: 'session-key-missing',
    })
    expect(noticeFromContractFailure(tab(41, 'CTAB'))).toEqual({
      kind: 'withdrawal-pending',
    })
    expect(noticeFromContractFailure(tab(35, 'CNOPE'))).toBeNull()
  })
})

describe('transaction outcomes map once for every flow', () => {
  test('each status shows and records one thing', () => {
    expect(viewFromTxOutcome({ status: 'sent', hash: 'ab' })).toEqual({
      show: { kind: 'sent', hash: 'ab' },
      record: null,
    })
    expect(
      viewFromTxOutcome({
        status: 'wallet_failed',
        error: { kind: 'cancelled' },
      })
    ).toEqual({
      show: { kind: 'cancelled' },
      record: { reason: 'wallet_rejected', detail: 'cancelled' },
    })
    expect(
      viewFromTxOutcome({
        status: 'wallet_failed',
        error: { kind: 'wrong-network', walletPassphrase: PUBLIC },
      }).show
    ).toEqual({
      kind: 'gate',
      gate: { kind: 'wrong-network', walletNetwork: 'Mainnet' },
    })
    expect(
      viewFromTxOutcome({ status: 'wallet_failed', error: { kind: 'timeout' } })
        .show
    ).toEqual({ kind: 'failed', failure: WALLET_FAILURE_COPY.timeout })
    const paused = viewFromTxOutcome({
      status: 'simulation_failed',
      error: {
        code: 1000,
        name: 'EnforcedPause',
        contract: 'core',
        message: '',
      },
      detail: 'HostError: Error(Contract, #1000)',
    })
    expect(paused).toEqual({
      show: { kind: 'notice', notice: { kind: 'paused' } },
      record: { reason: 'simulation_failed', detail: 'EnforcedPause' },
    })
    expect(
      viewFromTxOutcome({
        status: 'send_error',
        error: { code: null, name: null, contract: null, message: 'Refused.' },
        detail: 'txFailed',
      })
    ).toEqual({
      show: {
        kind: 'failed',
        failure: { title: 'Not sent', detail: 'Refused. Nothing was sent.' },
      },
      record: { reason: 'send_error' },
    })
    expect(
      viewFromTxOutcome({ status: 'not_sent', detail: 'TRY_AGAIN_LATER' })
    ).toEqual({
      show: { kind: 'failed', failure: FAILURE_COPY.notSentBusy },
      record: { reason: 'send_error', detail: 'TRY_AGAIN_LATER' },
    })
  })
})

describe('Convex tab refusals', () => {
  test('each code has its state', () => {
    const expected: Record<string, string> = {
      TAB_OVER_BALANCE: 'notice:insufficient-balance',
      TAB_OVER_KEY_LIMIT: 'notice:key-limit',
      TAB_RECEIPT_CAP: 'notice:key-limit',
      TAB_DAILY_LIMIT: 'notice:daily-limit',
      TAB_KEY_EXPIRED: 'notice:session-key-expired',
      TAB_KEY_UNKNOWN: 'notice:session-key-none',
      TAB_KEY_REVOKED: 'notice:session-key-none',
      TAB_PAIR_CLOSED: 'notice:session-key-none',
      TAB_NO_ACCOUNT: 'notice:tab-none',
      TAB_CLOSED: 'notice:tab-none',
      TAB_CLOSING: 'notice:tab-closing',
      TAB_READER_UNVERIFIED: 'gate:unverified',
      TAB_ARTICLE_HAS_SPLITS: 'tips-unavailable:splits',
      TAB_ARTICLE_NOT_REGISTERED: 'tips-unavailable:unregistered',
      TAB_ARTICLE_UNKNOWN: 'tips-unavailable:unregistered',
      TAB_WRITER_UNVERIFIED: 'tips-unavailable:payout_outdated',
      TAB_ABOVE_TIP_MAX: 'refused:aboveMax',
      TAB_BELOW_MINIMUM: 'refused:belowMinimum',
      TAB_SELF_TIP: 'refused:selfTip',
      TAB_PRICE_UNAVAILABLE: 'refused:noPrice',
      TAB_PREPARE_EXPIRED: 'refused:timedOut',
      TAB_DUPLICATE_REFERENCE: 'refused:duplicate',
      TAB_NO_WITHDRAWAL: 'refused:noWithdrawal',
    }
    const key = (code: string) => {
      const r = refusalFromTabError(code)
      switch (r.kind) {
        case 'notice':
          return `notice:${r.notice.kind}`
        case 'gate':
          return `gate:${r.gate.kind}`
        case 'tips-unavailable':
          return `tips-unavailable:${r.reason}`
        case 'refused': {
          const name = Object.entries(TAB_REFUSAL_COPY).find(
            ([, copy]) => copy === r.copy
          )?.[0]
          return `refused:${name}`
        }
      }
    }
    for (const [code, want] of Object.entries(expected)) {
      expect([code, key(code)]).toEqual([code, want])
    }
    expect(key('TAB_SOMETHING_NEW')).toBe('refused:generic')
  })

  test('every TAB_ code the tab functions throw is mapped', () => {
    const files = [
      'convex/tabs.ts',
      'convex/lib/chain/tabLedger.ts',
      'convex/lib/chain/voucher.ts',
      'convex/chain/config.ts',
    ]
    const thrown = new Set<string>()
    for (const file of files) {
      const text = readFileSync(path.join(ROOT, file), 'utf8')
      for (const match of text.matchAll(
        /(?:tabError\(\s*|code:\s*)['"](TAB_[A-Z_]+)['"]/g
      )) {
        thrown.add(match[1]!)
      }
      // Codes chosen by a ternary inside tabError(...).
      for (const match of text.matchAll(
        /\?\s*'(TAB_[A-Z_]+)'\s*:\s*'(TAB_[A-Z_]+)'/g
      )) {
        thrown.add(match[1]!)
        thrown.add(match[2]!)
      }
    }
    expect(thrown.size).toBeGreaterThan(20)
    const unmapped = [...thrown].filter(
      (code) => !TAB_REFUSAL_CODES.includes(code)
    )
    expect(unmapped).toEqual([])
  })
})

describe('amounts and dates', () => {
  test('formats stroops with full precision', () => {
    expect(formatXlm('10000000')).toBe('1 XLM')
    expect(formatXlm('9750000')).toBe('0.975 XLM')
    expect(formatXlm('39')).toBe('0.0000039 XLM')
    expect(formatXlm('123456789012345678')).toBe('12,345,678,901.2345678 XLM')
    expect(formatXlm('-5')).toBe('–')
    expect(formatXlm('1.5')).toBe('–')
  })

  test('the cents quote is optional and says the XLM is not real (#670)', () => {
    expect(formatCentsQuote(50)).toBe('$0.50')
    expect(formatCentsQuote(null)).toBeNull()
    expect(formatCentsQuote(Number.NaN)).toBeNull()
    expect(formatCentsQuote(0)).toBeNull()
    expect(formatCentsQuote(0.4)).toBe('under-a-cent')
    expect(quoteCopy('$1.00')).toBe('Worth about $1.00 if this were real XLM')
    expect(quoteCopy('$0.12')).toBe('Worth about $0.12 if this were real XLM')
    expect(quoteCopy('under-a-cent')).toBe(
      'Worth under $0.01 if this were real XLM'
    )
    // The caption names where the exact amount shows; a tab tip has no
    // wallet prompt, so its line does not mention the wallet.
    expect(ESTIMATE.caption).toBe(
      'Your wallet shows the exact amount before you approve.'
    )
    expect(ESTIMATE.tabCaption).toBe('The exact amount shows once you send.')
    expect(ESTIMATE.tabCaption).not.toMatch(/wallet/i)
    // No kit string states that testnet funds are real XLM.
    const strings: string[] = []
    const add = (value: unknown): void => {
      if (typeof value === 'string') strings.push(value)
      else if (typeof value === 'function') {
        try {
          add(value('{a}', '{b}', '{c}'))
        } catch {
          // A template that needs real arguments.
        }
      } else if (value && typeof value === 'object')
        for (const inner of Object.values(value)) add(inner)
    }
    add(kitCopyModule)
    add(tabCopyModule)
    expect(strings.filter((text) => /\bin real XLM\b/i.test(text))).toEqual([])
  })

  test('an estimate rounds to 2 decimals from 1 XLM, 3 below (#670)', () => {
    const at = (xlm: string) => {
      const [whole = '0', fraction = ''] = xlm.split('.')
      return estimateXlmCopy(
        (
          BigInt(whole) * BigInt(10_000_000) +
          BigInt(fraction.padEnd(7, '0'))
        ).toString()
      )
    }
    // The figures from the audit.
    expect(at('8.1052384')).toBe('About 8.11 XLM')
    expect(at('7.9026075')).toBe('About 7.9 XLM')
    expect(at('0.2026309')).toBe('About 0.203 XLM')
    // The 1 XLM boundary: three decimals below it, two from it.
    expect(at('0.9994999')).toBe('About 0.999 XLM')
    expect(at('0.9995')).toBe('About 1 XLM')
    expect(at('1')).toBe('About 1 XLM')
    expect(at('1.0049999')).toBe('About 1 XLM')
    expect(at('1.005')).toBe('About 1.01 XLM')
    // Half up at three decimals; a non-zero amount never reads as 0.
    expect(at('0.0005')).toBe('About 0.001 XLM')
    expect(at('0.0004999')).toBe('Under 0.001 XLM')
    expect(estimateXlmCopy('1')).toBe('Under 0.001 XLM')
    expect(estimateXlmCopy('0')).toBe('About 0 XLM')
    expect(at('12345678901.2345678')).toBe('About 12,345,678,901.23 XLM')
    expect(estimateXlmCopy('1.5')).toBe('–')
    expect(roundXlmEstimate('-5')).toBeNull()
    expect(roundXlmEstimate('4999')).toEqual({ text: '0.001 XLM', under: true })
    // An exact figure keeps every stroop.
    expect(formatXlm('81052384')).toBe('8.1052384 XLM')
    expect(formatXlm('4999')).toBe('0.0004999 XLM')
  })

  test('the Core split rounds the fee down and gives the writer the rest', () => {
    expect(coreTipSplit('40')).toEqual({ gross: '40', writer: '39', fee: '1' })
    expect(coreTipSplit('10000000')).toEqual({
      gross: '10000000',
      writer: '9750000',
      fee: '250000',
    })
    expect(coreTipSplit('39')).toEqual({ gross: '39', writer: '39', fee: '0' })
    const big = '170141183460469231731687303715884105727'
    const split = coreTipSplit(big)!
    expect(BigInt(split.writer) + BigInt(split.fee)).toBe(BigInt(big))
    expect(coreTipSplit('abc')).toBeNull()
  })

  test('addresses shorten in the middle', () => {
    expect(
      shortAddress('GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI')
    ).toBe('GBZX…MADI')
    expect(shortAddress('Ada')).toBe('Ada')
  })

  test('a future ledger becomes an estimated date', () => {
    const closedAt = Date.UTC(2026, 10, 27, 12)
    const unlock = estimateLedgerTime(1_000 + 3 * 17_280, {
      sequence: 1_000,
      closedAt,
    })
    expect(unlock.getTime() - closedAt).toBe(3 * 24 * 60 * 60 * 1000)
    expect(estimateLedgerTime(10, { sequence: 20, closedAt }).getTime()).toBe(
      closedAt
    )
    expect(formatDay(new Date(Date.UTC(2026, 10, 30, 12)), 'en-GB')).toBe(
      'Monday 30 November'
    )
  })

  test('explorer links go to the testnet explorer', () => {
    expect(explorerTxUrl('ab12')).toBe(
      'https://stellar.expert/explorer/testnet/tx/ab12'
    )
  })
})

describe('first load', () => {
  // scripts/perf forbids lib/stellar/v2 and the SDK in the article page's
  // first load. Walk the kit's value imports and check none reach them.
  const FORBIDDEN = [/lib\/stellar\/v2\//, /^@stellar\//, /^@creit\.tech\//]

  function resolve(from: string, spec: string): string | null {
    let base: string
    if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
    else if (spec.startsWith('.')) base = path.join(path.dirname(from), spec)
    else return null
    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const file = base + ext
      if (existsSync(file) && !file.endsWith('/')) {
        try {
          readFileSync(file)
          return file
        } catch {
          // a directory
        }
      }
    }
    return null
  }

  function valueImports(file: string): string[] {
    const text = readFileSync(file, 'utf8')
    const specs: string[] = []
    for (const match of text.matchAll(
      /^(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]/gm
    )) {
      specs.push(match[1]!)
    }
    for (const match of text.matchAll(/^import\s+['"]([^'"]+)['"]/gm)) {
      specs.push(match[1]!)
    }
    return specs
  }

  test('no kit module reaches v2 payment code, the SDK or Convex', () => {
    const entries = [
      ...readdirSync(path.join(ROOT, 'components/payments'))
        .filter((f) => /\.tsx?$/.test(f))
        .map((f) => path.join(ROOT, 'components/payments', f)),
      path.join(ROOT, 'lib/payments/ui-state.ts'),
      path.join(ROOT, 'lib/payments/failures.ts'),
      path.join(ROOT, 'lib/payments/format.ts'),
    ]
    const seen = new Set<string>()
    const bad: string[] = []
    const stack = [...entries]
    while (stack.length) {
      const file = stack.pop()!
      if (seen.has(file)) continue
      seen.add(file)
      for (const spec of valueImports(file)) {
        const rel = path.relative(ROOT, resolve(file, spec) ?? spec)
        if (FORBIDDEN.some((re) => re.test(spec) || re.test(rel))) {
          bad.push(`${path.relative(ROOT, file)} -> ${spec}`)
          continue
        }
        const next = resolve(file, spec)
        if (next && /\.tsx?$/.test(next)) stack.push(next)
      }
    }
    expect(seen.size).toBeGreaterThan(15)
    expect(bad).toEqual([])
  })
})

describe('copy', () => {
  test('every flow has confirmed copy', () => {
    for (const flow of PAYMENT_FLOWS) {
      expect(FLOW_COPY[flow].title.length).toBeGreaterThan(0)
    }
  })

  test('copy speaks about money only where the server verified it', () => {
    // These are shown from client knowledge or a server refusal, never from
    // verified chain data, so they may not claim what was paid or charged.
    const unverified = [
      FAILURE_COPY,
      WALLET_FAILURE_COPY,
      TAB_REFUSAL_COPY,
      TAB_OPERATION_RESULT,
      RESULT_COPY.failed,
      RESULT_COPY.declined,
      NOTICE_COPY.basketItemUnavailable,
      gateCopy('wrong-network', { walletNetwork: 'Mainnet' }),
      gateCopy('disconnected', { ended: true }),
    ]
    const text = JSON.stringify(unverified)
    expect(text).not.toMatch(/\bpaid\b|\bcharged\b|was signed(?! or sent)/i)
    expect(
      failureFromContract({
        code: null,
        name: null,
        contract: null,
        message: 'Stellar testnet refused the transaction. Nothing was sent.',
      }).detail
    ).toBe('Stellar testnet refused the transaction. Nothing was sent.')
  })

  test('no copy promises a fixed wait that a slow network can break', () => {
    // A prepared request expires only after the indexer passes its maxTime,
    // the recheck runs every 2 minutes, and the settler can fall behind, so a
    // wait stated in seconds, minutes or hours must say "usually" (#537).
    // Deadlines the code enforces ("expires after 15 minutes") are not waits.
    const strings: string[] = []
    const add = (value: unknown, depth = 0): void => {
      if (typeof value === 'string') strings.push(value)
      else if (typeof value === 'function' && depth < 3) {
        try {
          add(value('{a}', '{b}', '{c}'), depth + 1)
        } catch {
          // A template that needs real arguments has no fixed wait in it.
        }
      } else if (value && typeof value === 'object')
        for (const inner of Object.values(value)) add(inner, depth)
    }
    add(kitCopyModule)
    add(tabCopyModule)
    expect(strings.length).toBeGreaterThan(100)
    const wait =
      /\b(up to|within|in)\s+(about\s+)?\d+\s*(seconds?|minutes?|hours?)\b/i
    const promises = strings
      .flatMap((text) => text.split(/(?<=\.)\s+/))
      .filter((sentence) => wait.test(sentence))
    // The detector finds a stated wait. The tab tip copy no longer states
    // one: it names the settlement rule instead (#547).
    expect(wait.test('It usually settles within about 6 hours.')).toBe(true)
    expect(
      promises.filter((sentence) => !/\busually\b/i.test(sentence))
    ).toEqual([])
    expect(RESUMING_COPY).not.toMatch(/\d+\s*minutes?/)
  })

  test('the testnet label text is fixed', () => {
    expect(TESTNET_LABEL).toBe('Stellar testnet')
  })

  test('the design doc quotes every string the kit shows', () => {
    const doc = readFileSync(
      path.join(ROOT, 'docs/design-system/payment-states.md'),
      'utf8'
    )
    const strings = new Set<string>()
    const add = (value: unknown) => {
      if (typeof value === 'string') strings.add(value)
      else if (typeof value === 'function') return
      else if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) add(inner)
      }
    }
    add([TESTNET_LABEL, TESTNET_LABEL_DETAIL, ESTIMATE, GATE_BUSY])
    add([PROGRESS_HEADING, SIGNING_HELP, CANCEL_LABEL, RESUMING_COPY])
    add([
      RETRY_LABEL,
      DONE_LABEL,
      VIEW_TRANSACTION,
      REFERENCE_LABEL,
      HELP_LABEL,
    ])
    add(FLOW_COPY)
    add(RESULT_COPY)
    add(TAB_TIP_RESULT)
    add(STEP_COPY)
    add(STEP_COPY.checking())
    add(STEP_LABEL)
    add(STATUS_LABEL)
    add(CHECKING_SLOW)
    add(TAB_TIP_SENDING)
    add(FAILURE_COPY)
    add(WALLET_FAILURE_COPY)
    add(TAB_REFUSAL_COPY)
    add(TAB_OPERATION_RESULT)
    add(NOTICE_ACTION)
    add(NOTICE_COPY)
    add(TIPS_UNAVAILABLE_COPY)
    add(NOTICE_COPY.insufficientWallet())
    add(NOTICE_COPY.insufficientTab())
    add(NOTICE_COPY.tabShort())
    add(NOTICE_COPY.withdrawalPending())
    add([
      SESSION_KEY_COPY.label,
      SESSION_KEY_COPY.expired,
      SESSION_KEY_COPY.revoked,
      SESSION_KEY_COPY.revoke,
      SESSION_KEY_COPY.renew,
    ])
    add(quoteCopy('under-a-cent'))
    for (const kind of [
      'checking',
      'signed-out',
      'no-wallet',
      'disconnected',
      'locked',
      'unverified',
    ] as const) {
      add(gateCopy(kind))
    }
    add(gateCopy('wrong-network', { walletNetwork: 'Mainnet' }))
    add(gateCopy('disconnected', { ended: true }))
    // Templates: the doc shows them with {placeholders}.
    const templates = [
      tabCloseConfirmed('{date}').detail,
      NOTICE_COPY.withdrawalPending('{date}').title,
      NOTICE_COPY.insufficientWallet('{needed}', '{available}').detail,
      NOTICE_COPY.insufficientTab('{available}').detail,
      NOTICE_COPY.tabShort('{short}').detail,
      NOTICE_COPY.nftThreshold('{tipped}', '{threshold}').title,
      NOTICE_COPY.nftThreshold('{tipped}', '{threshold}').detail,
      basketConfirmed(2).detail.replace('2', '{n}'),
      STEP_COPY.checking('{place}'),
      SESSION_KEY_COPY.expires('{date}'),
      SESSION_KEY_COPY.used('{used}', '{limit}'),
      quoteCopy('{usd}'),
      WRONG_ACCOUNT_AFTER_SIGNING('{linked}').detail,
      gateCopy('other-account', { linked: '{linked}', address: '{wallet}' })
        .title,
      gateCopy('other-account', { linked: '{linked}', address: '{wallet}' })
        .detail,
    ]
    for (const t of templates) strings.add(t)
    const missing = [...strings].filter((value) => !doc.includes(value))
    expect(missing).toEqual([])
  })
})
