import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  CHAIN_RECORD_STATUSES,
  type ChainRecordStatus,
} from '../../convex/lib/chain/schema'
import {
  CHECKING_SLOW,
  FLOW_COPY,
  NOTICE_ACTION,
  NOTICE_COPY,
  RESULT_COPY,
  STATUS_LABEL,
  STEP_COPY,
  STEP_LABEL,
  TAB_TIP_SENDING,
  gateCopy,
} from '../../lib/copy/payment-states'
import {
  coreTipSplit,
  explorerTxUrl,
  formatCentsQuote,
  formatXlm,
} from '../../lib/payments/format'
import {
  PAYMENT_FLOWS,
  canRetry,
  failureFromContract,
  failureFromWalletError,
  gateFromWalletError,
  isFinalPhase,
  noticeFromContractFailure,
  phaseFromRecord,
  phaseFromTabTip,
  type PaymentPhase,
  type TabTipStatus,
} from '../../lib/payments/ui-state'
import {
  WalletError,
  walletErrorMessage,
} from '../../lib/stellar/v2/wallet-errors'

const ALL_PHASES = Object.keys(STATUS_LABEL) as PaymentPhase[]
const TESTNET = 'Test SDF Network ; September 2015'
const PUBLIC = 'Public Global Stellar Network ; September 2015'

describe('server status to phase', () => {
  test('maps every chain record status', () => {
    const expected: Record<ChainRecordStatus, PaymentPhase> = {
      PREPARED: 'checking',
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

  test('an author mismatch is a completed payment to the registered address', () => {
    expect(
      phaseFromRecord({ status: 'MISMATCH', mismatchReason: 'author' })
    ).toBe('sent-to-registered')
    for (const reason of ['field:gross', 'field:ledger', 'no_event', null]) {
      expect(
        phaseFromRecord({ status: 'MISMATCH', mismatchReason: reason })
      ).toBe('under-review')
    }
  })

  test('a live client step shows only while the record is PREPARED', () => {
    expect(phaseFromRecord({ status: 'PREPARED' }, 'signing')).toBe('signing')
    expect(phaseFromRecord({ status: 'SUBMITTED' }, 'signing')).toBe('checking')
    expect(phaseFromRecord({ status: 'CONFIRMED' }, 'sending')).toBe(
      'confirmed'
    )
    expect(phaseFromRecord({ status: 'FAILED' }, 'simulating')).toBe('failed')
  })

  test('maps every tab tip status', () => {
    const expected: Record<TabTipStatus, PaymentPhase> = {
      ACCEPTED: 'accepted',
      SETTLED: 'settled',
      SHORTFALL: 'shortfall',
      UNPAID: 'unpaid',
      REJECTED: 'under-review',
      VOID_RESET: 'void-reset',
    }
    for (const [status, phase] of Object.entries(expected)) {
      expect(phaseFromTabTip(status as TabTipStatus)).toBe(phase)
    }
  })
})

describe('retry rule', () => {
  test('retry is offered for failed and expired only', () => {
    const retryable = ALL_PHASES.filter(canRetry)
    expect(retryable.sort()).toEqual(['expired', 'failed'])
  })

  test('no mismatch outcome can offer retry', () => {
    for (const reason of ['author', 'field:gross', 'no_event']) {
      expect(
        canRetry(
          phaseFromRecord({ status: 'MISMATCH', mismatchReason: reason })
        )
      ).toBe(false)
    }
  })

  test('running phases are not final', () => {
    for (const phase of [
      'simulating',
      'signing',
      'sending',
      'checking',
      'accepted',
      'shortfall',
    ] as const) {
      expect(isFinalPhase(phase)).toBe(false)
    }
    expect(isFinalPhase('confirmed')).toBe(true)
    expect(isFinalPhase('sent-to-registered')).toBe(true)
  })
})

describe('wallet failures', () => {
  test('connection failures become gate states', () => {
    expect(gateFromWalletError(new WalletError('no-wallet', ''))).toEqual({
      kind: 'no-wallet',
    })
    expect(gateFromWalletError(new WalletError('locked', ''))).toEqual({
      kind: 'locked',
    })
    expect(
      gateFromWalletError(
        new WalletError('wrong-network', '', {
          expectedPassphrase: TESTNET,
          walletPassphrase: PUBLIC,
        })
      )
    ).toEqual({ kind: 'wrong-network', walletNetwork: 'Mainnet' })
  })

  test('signing failures stay in the progress view', () => {
    for (const kind of [
      'rejected',
      'timeout',
      'wrong-account',
      'unsupported',
      'failed',
      'cancelled',
    ] as const) {
      expect(gateFromWalletError(new WalletError(kind, 'x'))).toBeNull()
    }
    expect(failureFromWalletError(new WalletError('rejected', ''))?.title).toBe(
      'Request declined in your wallet'
    )
    expect(failureFromWalletError(new WalletError('cancelled', ''))).toBeNull()
  })

  test('the gate says what a failed connect says', () => {
    for (const kind of ['no-wallet', 'locked'] as const) {
      const fromAdapter = walletErrorMessage(new WalletError(kind, ''))!
      const fromGate = gateCopy(kind)
      expect(fromGate.title).toBe(fromAdapter.title)
      expect(fromGate.detail).toBe(fromAdapter.detail)
    }
    const adapter = walletErrorMessage(
      new WalletError('wrong-network', '', {
        expectedPassphrase: TESTNET,
        walletPassphrase: PUBLIC,
      })
    )!
    expect(gateCopy('wrong-network', { walletNetwork: 'Mainnet' }).title).toBe(
      adapter.title
    )
  })
})

describe('contract failures', () => {
  const info = (code: number | null, message = 'm') => ({
    code,
    name: null,
    message,
  })

  test('codes with a standing condition become notices', () => {
    expect(noticeFromContractFailure(info(1000))).toEqual({ kind: 'paused' })
    expect(noticeFromContractFailure(info(1))).toEqual({
      kind: 'tips-unavailable',
      reason: 'unregistered',
    })
    expect(noticeFromContractFailure(info(35))).toEqual({
      kind: 'session-key-missing',
    })
    expect(noticeFromContractFailure(info(41))).toEqual({
      kind: 'withdrawal-pending',
    })
    expect(
      noticeFromContractFailure(info(null), 'tx_insufficient_balance')
    ).toEqual({ kind: 'insufficient-balance', source: 'wallet' })
  })

  test('other codes are plain failures that say nothing was paid', () => {
    expect(noticeFromContractFailure(info(8))).toBeNull()
    expect(noticeFromContractFailure(info(null), 'txBadSeq')).toBeNull()
    expect(
      failureFromContract(info(8, 'This tip is below the minimum.'))
    ).toEqual({
      title: 'Not sent',
      detail: 'This tip is below the minimum. Nothing was paid.',
    })
  })
})

describe('amounts', () => {
  test('formats stroops with full precision', () => {
    expect(formatXlm('10000000')).toBe('1 XLM')
    expect(formatXlm('9750000')).toBe('0.975 XLM')
    expect(formatXlm('39')).toBe('0.0000039 XLM')
    expect(formatXlm('123456789012345678')).toBe('12,345,678,901.2345678 XLM')
    expect(formatXlm('-5')).toBe('–')
    expect(formatXlm('1.5')).toBe('–')
  })

  test('the cents quote is optional', () => {
    expect(formatCentsQuote(50)).toBe('$0.50')
    expect(formatCentsQuote(null)).toBeNull()
    expect(formatCentsQuote(Number.NaN)).toBeNull()
    expect(formatCentsQuote(0)).toBeNull()
    expect(formatCentsQuote(0.4)).toBe('under $0.01')
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

  test('explorer links go to the testnet explorer', () => {
    expect(explorerTxUrl('ab12')).toBe(
      'https://stellar.expert/explorer/testnet/tx/ab12'
    )
  })
})

describe('copy', () => {
  test('every flow has confirmed copy', () => {
    for (const flow of PAYMENT_FLOWS) {
      expect(FLOW_COPY[flow].confirmed.title.length).toBeGreaterThan(0)
    }
  })

  test('the design doc quotes every string the kit shows', () => {
    const doc = readFileSync(
      path.join(__dirname, '../../docs/design-system/payment-states.md'),
      'utf8'
    )
    const strings = new Set<string>()
    const add = (value: unknown) => {
      if (typeof value === 'string') strings.add(value)
      else if (value && typeof value === 'object') {
        for (const inner of Object.values(value)) add(inner)
      }
    }
    add(FLOW_COPY)
    add(RESULT_COPY)
    add(STEP_COPY)
    add(STEP_LABEL)
    add(STATUS_LABEL)
    add(CHECKING_SLOW)
    add(TAB_TIP_SENDING)
    add(NOTICE_ACTION)
    add(NOTICE_COPY.paused)
    add(NOTICE_COPY.sessionKeyMissing)
    add(NOTICE_COPY.sessionKeyExpired)
    add(NOTICE_COPY.settlementDelayedReader)
    add(NOTICE_COPY.settlementDelayedWriter)
    add(NOTICE_COPY.tipsUnavailable)
    add(NOTICE_COPY.withdrawalReady)
    add(NOTICE_COPY.networkBusy)
    add(NOTICE_COPY.insufficientWallet())
    add(NOTICE_COPY.insufficientTab())
    add(NOTICE_COPY.withdrawalPending())
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
    const missing = [...strings].filter((value) => !doc.includes(value))
    expect(missing).toEqual([])
  })
})
