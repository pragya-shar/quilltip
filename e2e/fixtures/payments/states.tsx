/**
 * Every state of the payment kit, by id. The fixture page renders one with
 * `?state=<id>`; the spec and the screenshot run iterate this list. Progress
 * states are built from server records, tab tips and tab state, so the
 * fixture runs the same mapping as the flows.
 */
import type { ReactNode } from 'react'
import { AmountSummary } from '../../../components/payments/AmountSummary'
import { PaymentNotice } from '../../../components/payments/PaymentNotice'
import { PaymentStatusLabel } from '../../../components/payments/PaymentStatusLabel'
import { SessionKeyRow } from '../../../components/payments/SessionKeyRow'
import { TestnetLabel } from '../../../components/payments/TestnetLabel'
import { TransactionProgress } from '../../../components/payments/TransactionProgress'
import { WalletGate } from '../../../components/payments/WalletGate'
import type {
  PaymentFlow,
  PaymentPhase,
  ProgressSource,
  TabSnapshot,
  WalletGateState,
} from '../../../components/payments/payment-types'
import { STATUS_LABEL } from '../../../lib/copy/payment-states'
import {
  failureFromContract,
  failureFromWalletError,
  gateFromWalletError,
  refusalFromTabError,
  viewFromTxOutcome,
} from '../../../lib/payments/failures'
import { PAYMENT_FLOWS, type ClientStep } from '../../../lib/payments/ui-state'

export type Surface = 'dialog' | 'page'

export type FixtureState = {
  id: string
  group: 'gate' | 'progress' | 'result' | 'amount' | 'notice' | 'label' | 'key'
  surface: Surface
  render: () => ReactNode
}

export const HASH =
  '9f2c4b1e7a3d5c6b8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d'
export const ADDRESS =
  'GBZXN7PIRZGNMHGA7MUUUF4GWPY5AYPV6LY4UV2GL6VJGIQRXFDNMADI'
/** The reader's verified linked address, when the wallet is on another. */
export const LINKED = 'GCS5XCIKIBZ3L5CUKJMMAG6IUBBNCCPT5SFTXFW5I4DZOMT4RJ43DUAR'
const WRITER = 'Ada Lovelace'

/** Calls the fixture records, so the spec can assert what a button did. */
export function record(name: string) {
  return () => {
    const log = ((window as unknown as { __calls?: string[] }).__calls ??= [])
    log.push(name)
  }
}

/** A source for a server record, as `getSubmissionStatus` returns it. */
export function recordSource(
  status: string,
  extra: {
    mismatchReason?: string
    needsReview?: boolean
    step?: ClientStep
    declined?: boolean
  } = {}
): ProgressSource {
  const { step, declined, ...rest } = extra
  return { record: { status, ...rest }, step, declined }
}

/** The record and client state that produce each phase, for the live demo. */
export function sourceForPhase(phase: PaymentPhase): ProgressSource {
  switch (phase) {
    case 'simulating':
    case 'signing':
    case 'sending':
      return recordSource('PREPARED', { step: phase })
    case 'checking':
      return recordSource('SUBMITTED')
    case 'confirmed':
      return recordSource('CONFIRMED')
    case 'sent-to-registered':
      return recordSource('MISMATCH', { mismatchReason: 'author' })
    case 'under-review':
      return recordSource('MISMATCH', {
        mismatchReason: 'field:amount',
        needsReview: true,
      })
    case 'failed':
      return recordSource('FAILED')
    case 'expired':
      return recordSource('EXPIRED')
    case 'declined':
      return recordSource('FAILED', { declined: true })
    default:
      return recordSource('PREPARED')
  }
}

const send = (
  <button type="button" className="pay-fixture-send">
    Send tip
  </button>
)

function gate(id: string, state: WalletGateState, busy = false) {
  return {
    id,
    group: 'gate' as const,
    surface: 'dialog' as const,
    render: () => (
      <WalletGate
        state={state}
        busy={busy}
        onSignIn={record('sign-in')}
        onInstall={record('install')}
        onConnect={record('connect')}
        onRecheck={record('recheck')}
        onVerify={record('verify')}
      >
        {send}
      </WalletGate>
    ),
  }
}

type ProgressProps = Parameters<typeof TransactionProgress>[0]

function progress(
  id: string,
  flow: PaymentFlow,
  source: ProgressSource,
  extra: Partial<ProgressProps> = {},
  options: { running?: boolean; surface?: Surface } = {}
): FixtureState {
  const pageFlow =
    flow.startsWith('tab') || flow === 'collect' || flow === 'settle-own'
  return {
    id,
    group: options.running ? 'progress' : 'result',
    surface: options.surface ?? (pageFlow ? 'page' : 'dialog'),
    render: () => (
      <TransactionProgress
        flow={flow}
        source={source}
        onRetry={record('retry')}
        {...extra}
      />
    ),
  }
}

function running(
  id: string,
  flow: PaymentFlow,
  source: ProgressSource,
  extra: Partial<ProgressProps> = {}
) {
  return progress(id, flow, source, extra, { running: true })
}

const TIP = { amount: '10000000', to: WRITER }

const LONG_ERROR = failureFromContract({
  code: null,
  name: null,
  contract: null,
  message:
    'Stellar refused the transaction because the account sequence number moved while the wallet was signing, the fee bid was below the surge price for ledger 51234567, and the footprint for contract CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS was archived and had to be restored first.',
})

const BUSY = viewFromTxOutcome({
  status: 'not_sent',
  detail: 'TRY_AGAIN_LATER',
})

const OPEN_TAB: NonNullable<TabSnapshot> = {
  status: 'OPEN',
  confirmedBalance: '200000000',
  keys: [
    { keyId: 'k1', revoked: false },
    { keyId: 'k0', revoked: true },
  ],
}

/** Confirmed sources per flow: records for wallet flows, tab state for tab operations. */
function confirmedSource(flow: PaymentFlow): ProgressSource {
  switch (flow) {
    case 'tab-open':
      return { tabOperation: { flow }, tab: OPEN_TAB }
    case 'tab-top-up':
      return {
        tabOperation: { flow, before: '100000000' },
        tab: OPEN_TAB,
      }
    case 'tab-new-key':
      return { tabOperation: { flow, keyId: 'k1' }, tab: OPEN_TAB }
    case 'tab-revoke-key':
      return { tabOperation: { flow, keyId: 'k0' }, tab: OPEN_TAB }
    case 'tab-close':
      return {
        tabOperation: { flow },
        tab: { ...OPEN_TAB, status: 'CLOSING' },
      }
    case 'tab-withdraw':
      return {
        tabOperation: { flow },
        tab: { ...OPEN_TAB, status: 'CLOSED', confirmedBalance: '0' },
      }
    case 'tab-tip':
      return { tabTip: { status: 'SETTLED' } }
    default:
      return recordSource('CONFIRMED')
  }
}

const CONFIRMED_SUMMARY: Partial<
  Record<PaymentFlow, ProgressProps['summary']>
> = {
  'direct-tip': TIP,
  'highlight-tip': TIP,
  'tip-basket': { amount: '35000000' },
  'tab-top-up': { amount: '100000000' },
  'tab-withdraw': { amount: '84000000' },
  collect: { amount: '84000000' },
  'settle-own': { amount: '12500000' },
  'nft-transfer': undefined,
}

const TAB_OP_HASH = new Set<PaymentFlow>([
  'tab-open',
  'tab-top-up',
  'tab-new-key',
  'tab-revoke-key',
  'tab-close',
  'tab-withdraw',
])

export const STATES: FixtureState[] = [
  gate('gate-signed-out', { kind: 'signed-out' }),
  gate('gate-no-wallet', { kind: 'no-wallet' }),
  gate('gate-disconnected', { kind: 'disconnected' }),
  // The wallet ended the connection while signing (for example a
  // WalletConnect session closed), mapped from the wallet error.
  gate(
    'gate-disconnected-ended',
    gateFromWalletError({ kind: 'disconnected' }) ?? { kind: 'ready' }
  ),
  gate('gate-locked', { kind: 'locked' }),
  gate('gate-wrong-network', {
    kind: 'wrong-network',
    walletNetwork: 'Mainnet',
  }),
  gate('gate-unverified', { kind: 'unverified', address: ADDRESS }),
  // A verified linked address, and the wallet on another account (#582):
  // switch accounts, with a link to wallet settings; no link step.
  {
    id: 'gate-other-account',
    group: 'gate' as const,
    surface: 'page' as const,
    render: () => (
      <WalletGate
        state={{ kind: 'other-account', linked: LINKED, address: ADDRESS }}
        onConnect={record('connect')}
        onVerify={record('verify')}
        verifyHref="#wallet"
      >
        {send}
      </WalletGate>
    ),
  },
  // The tab pages link to the wallet page instead of verifying in place.
  {
    id: 'gate-unverified-link',
    group: 'gate' as const,
    surface: 'page' as const,
    render: () => (
      <WalletGate
        state={{ kind: 'unverified', address: ADDRESS }}
        verifyHref="#wallet"
      >
        {send}
      </WalletGate>
    ),
  },
  gate('gate-checking', { kind: 'checking' }),
  gate('gate-busy', { kind: 'disconnected' }, true),
  gate('gate-ready', { kind: 'ready' }),

  running(
    'progress-simulating',
    'direct-tip',
    recordSource('PREPARED', { step: 'simulating' })
  ),
  running(
    'progress-signing',
    'direct-tip',
    recordSource('PREPARED', { step: 'signing' }),
    { onCancel: record('cancel') }
  ),
  running(
    'progress-sending',
    'direct-tip',
    recordSource('PREPARED', { step: 'sending' })
  ),
  running('progress-checking', 'direct-tip', recordSource('SUBMITTED'), {
    txHash: HASH,
  }),
  running('progress-checking-slow', 'direct-tip', recordSource('SUBMITTED'), {
    txHash: HASH,
    slow: true,
  }),
  // A reload while the record is still PREPARED: nothing is claimed as done.
  running('progress-resuming', 'direct-tip', recordSource('PREPARED')),
  // A status the kit does not know (a v1 row): safe, no retry.
  running('progress-unknown-status', 'direct-tip', recordSource('PENDING')),
  running(
    'tab-op-checking',
    'tab-top-up',
    {
      tabOperation: { flow: 'tab-top-up', before: '200000000' },
      tab: OPEN_TAB,
      sent: true,
    },
    { txHash: HASH, resultPlace: 'your tab' }
  ),

  progress(
    'result-sent-to-registered',
    'direct-tip',
    recordSource('MISMATCH', { mismatchReason: 'author' }),
    { txHash: HASH, summary: TIP }
  ),
  progress(
    'result-under-review',
    'direct-tip',
    recordSource('MISMATCH', {
      mismatchReason: 'field:amount',
      needsReview: true,
    }),
    {
      txHash: HASH,
      summary: TIP,
      reference: 'k57d9x2tq0hf3m8r1c4v6w',
      helpHref: '#help',
    }
  ),
  progress('result-failed', 'direct-tip', recordSource('FAILED'), {
    txHash: HASH,
    summary: TIP,
  }),
  progress(
    'result-declined',
    'direct-tip',
    recordSource('FAILED', { declined: true }),
    { summary: TIP }
  ),
  // Declined, but `recordSendFailed` has not answered yet: no retry.
  progress(
    'result-declined-unrecorded',
    'direct-tip',
    recordSource('PREPARED', { declined: true }),
    { summary: TIP }
  ),
  progress('result-failed-wallet', 'direct-tip', recordSource('FAILED'), {
    failure: failureFromWalletError({ kind: 'timeout' }),
    summary: TIP,
  }),
  progress('result-failed-popup', 'direct-tip', recordSource('FAILED'), {
    failure: failureFromWalletError({ kind: 'popup-blocked' }),
    summary: TIP,
  }),
  progress('result-failed-long', 'direct-tip', recordSource('FAILED'), {
    failure: LONG_ERROR,
    summary: TIP,
  }),
  progress('result-failed-busy', 'direct-tip', recordSource('FAILED'), {
    failure: BUSY.show.kind === 'failed' ? BUSY.show.failure : null,
    summary: TIP,
  }),
  // An event arrived after the failure (`needsReview`): the payment may
  // have landed, so it reads as under review, with no retry.
  progress(
    'result-expired-review',
    'direct-tip',
    recordSource('EXPIRED', { needsReview: true }),
    { txHash: HASH, summary: TIP }
  ),
  progress(
    'result-failed-review',
    'direct-tip',
    recordSource('FAILED', { needsReview: true }),
    { txHash: HASH, summary: TIP }
  ),
  progress('result-expired', 'direct-tip', recordSource('EXPIRED'), {
    summary: TIP,
  }),
  progress('result-confirmed-done', 'direct-tip', recordSource('CONFIRMED'), {
    txHash: HASH,
    summary: TIP,
    doneAction: { onClick: record('done') },
  }),
  progress(
    'result-basket-redirected',
    'tip-basket',
    {
      record: { status: 'MISMATCH', mismatchReason: 'author' },
      rows: [
        { status: 'CONFIRMED' },
        { status: 'MISMATCH', mismatchReason: 'author' },
        { status: 'CONFIRMED' },
      ],
    },
    { txHash: HASH, summary: { amount: '35000000' } }
  ),
  progress(
    'result-basket-review',
    'tip-basket',
    {
      record: { status: 'MISMATCH', mismatchReason: 'field:amount' },
      rows: [
        { status: 'CONFIRMED' },
        { status: 'MISMATCH', mismatchReason: 'field:amount' },
      ],
    },
    { txHash: HASH, summary: { amount: '35000000' } }
  ),
  progress(
    'result-tab-close-date',
    'tab-close',
    {
      tabOperation: { flow: 'tab-close' },
      tab: { ...OPEN_TAB, status: 'CLOSING' },
    },
    { txHash: HASH, unlocksAround: 'Saturday 30 November' }
  ),
  progress(
    'result-tab-op-failed',
    'tab-top-up',
    {
      tabOperation: { flow: 'tab-top-up', before: '200000000' },
      tab: OPEN_TAB,
      sent: true,
      poll: 'FAILED',
    },
    { txHash: HASH, summary: { amount: '100000000' } }
  ),
  // The flow knows why it failed (here, Stellar testnet refused the send),
  // so its failure copy replaces the polling copy.
  progress(
    'result-tab-op-failed-busy',
    'tab-top-up',
    {
      tabOperation: { flow: 'tab-top-up', before: '200000000' },
      tab: OPEN_TAB,
      poll: 'FAILED',
    },
    {
      failure: BUSY.show.kind === 'failed' ? BUSY.show.failure : null,
      summary: { amount: '100000000' },
    }
  ),
  // A failure passed with an expired tab operation does not replace the
  // tab operation copy: only `failed` takes the flow's failure.
  progress(
    'result-tab-op-expired-with-failure',
    'tab-top-up',
    {
      tabOperation: { flow: 'tab-top-up', before: '200000000' },
      tab: OPEN_TAB,
      sent: true,
      poll: 'TIMEOUT',
    },
    {
      failure: BUSY.show.kind === 'failed' ? BUSY.show.failure : null,
      txHash: HASH,
      summary: { amount: '100000000' },
    }
  ),
  progress(
    'result-tab-op-expired',
    'tab-top-up',
    {
      tabOperation: { flow: 'tab-top-up', before: '200000000' },
      tab: OPEN_TAB,
      sent: true,
      poll: 'TIMEOUT',
    },
    { txHash: HASH, summary: { amount: '100000000' } }
  ),

  running('tab-tip-sending', 'tab-tip', { clientStep: 'sending' }),
  // Each tab tip passes a hash, so the tests check that the view hides the
  // link for phases with no transaction of their own.
  progress(
    'tab-tip-accepted',
    'tab-tip',
    { tabTip: { status: 'ACCEPTED' } },
    { txHash: HASH }
  ),
  progress(
    'tab-tip-settled',
    'tab-tip',
    { tabTip: { status: 'SETTLED' } },
    // The settlement transaction that paid it.
    { txHash: HASH, summary: TIP }
  ),
  progress(
    'tab-tip-shortfall',
    'tab-tip',
    { tabTip: { status: 'SHORTFALL' } },
    { txHash: HASH }
  ),
  progress(
    'tab-tip-unpaid',
    'tab-tip',
    { tabTip: { status: 'UNPAID' } },
    { txHash: HASH }
  ),
  progress(
    'tab-tip-unpaid-writer',
    'tab-tip',
    { tabTip: { status: 'UNPAID' } },
    { audience: 'writer', txHash: HASH }
  ),
  progress(
    'tab-tip-rejected',
    'tab-tip',
    { tabTip: { status: 'REJECTED' } },
    { txHash: HASH }
  ),
  progress(
    'tab-tip-rejected-writer',
    'tab-tip',
    { tabTip: { status: 'REJECTED' } },
    { audience: 'writer', helpHref: '#help', txHash: HASH }
  ),
  progress(
    'tab-tip-void-reset',
    'tab-tip',
    { tabTip: { status: 'VOID_RESET' } },
    { txHash: HASH }
  ),

  ...PAYMENT_FLOWS.filter((flow) => flow !== 'tab-tip').map((flow) =>
    progress(`confirmed-${flow}`, flow, confirmedSource(flow), {
      txHash: HASH,
      summary: CONFIRMED_SUMMARY[flow],
      resultPlace: TAB_OP_HASH.has(flow) ? 'your tab' : undefined,
    })
  ),

  {
    id: 'amount-tip',
    group: 'amount',
    surface: 'dialog',
    render: () => (
      <AmountSummary
        total="10000000"
        quoteCents={12}
        breakdown={[
          { label: 'To the author', amount: '9750000' },
          { label: 'Platform fee', amount: '250000' },
        ]}
      />
    ),
  },
  {
    // Before prepare returns: a client conversion from the chosen cents.
    id: 'amount-estimate',
    group: 'amount',
    surface: 'dialog',
    render: () => (
      <AmountSummary
        total="10000000"
        quoteCents={12}
        estimate
        breakdown={[
          { label: 'To the author', amount: '9750000' },
          { label: 'Platform fee', amount: '250000' },
        ]}
      />
    ),
  },
  {
    id: 'amount-long',
    group: 'amount',
    surface: 'dialog',
    render: () => (
      <AmountSummary
        total="100000000001"
        quoteCents={1200000}
        breakdown={[
          {
            label: 'To Margarethe Josephine Abernathy-Castellanos, co-author',
            amount: '48750000000',
          },
          { label: 'To the author', amount: '48750000001' },
          { label: 'Platform fee', amount: '2500000000' },
        ]}
      />
    ),
  },
  {
    id: 'amount-basket',
    group: 'amount',
    surface: 'dialog',
    render: () => (
      <AmountSummary
        label="Total for 3 tips"
        total="35000000"
        quoteCents={42}
        items={[
          {
            label: 'The words we keep',
            amount: '10000000',
            status: 'confirmed',
          },
          {
            label: '“A passage about rivers that ran backwards”',
            amount: '5000000',
            status: 'sent-to-registered',
          },
          {
            label: 'Notes from a cold harbour',
            amount: '20000000',
            note: 'Tips aren’t on for this article yet.',
          },
        ]}
        breakdown={[
          { label: 'To the authors', amount: '34125000' },
          { label: 'Platform fee', amount: '875000' },
        ]}
      />
    ),
  },
  {
    // The basket limit is 10 tips (section 5.4); titles are real-length.
    id: 'amount-basket-full',
    group: 'amount',
    surface: 'dialog',
    render: () => (
      <AmountSummary
        label="Total for 10 tips"
        total="1000000000"
        quoteCents={0.4}
        items={Array.from({ length: 10 }, (_, index) => ({
          label:
            index === 0
              ? 'Notes Toward a Natural History of Abandoned Railway Stations in the Polish Countryside, Part Three: Wiśniewska-Kowalczyk’s Ledger'
              : index === 1
                ? 'Jo'
                : `Letters from the harbour, ${index + 1}`,
          amount: index === 0 ? '40' : '111111107',
        }))}
        breakdown={[
          { label: 'To the authors', amount: '975000000' },
          { label: 'Platform fee', amount: '25000000' },
        ]}
      />
    ),
  },
  {
    id: 'amount-top-up',
    group: 'amount',
    surface: 'page',
    render: () => (
      <AmountSummary label="Top-up" total="100000000" quoteCents={120} />
    ),
  },

  notice('notice-paused', <PaymentNotice kind="paused" />),
  notice(
    'notice-paused-writer',
    <PaymentNotice kind="paused" audience="writer" />
  ),
  notice(
    'notice-insufficient-wallet',
    <PaymentNotice
      kind="insufficient-balance"
      source="wallet"
      needed="50000000"
      available="12500000"
      action={{ onClick: record('smaller') }}
    />,
    'dialog'
  ),
  notice(
    'notice-insufficient-tab',
    <PaymentNotice
      kind="insufficient-balance"
      source="tab"
      available="4000000"
      action={{ onClick: record('top-up') }}
    />,
    'dialog'
  ),
  notice(
    'notice-key-none',
    <PaymentNotice
      kind="session-key-none"
      action={{ onClick: record('new-key') }}
    />
  ),
  notice(
    'notice-key-missing',
    <PaymentNotice
      kind="session-key-missing"
      action={{ onClick: record('new-key') }}
    />
  ),
  notice(
    'notice-key-expired',
    <PaymentNotice
      kind="session-key-expired"
      action={{ onClick: record('renew-key') }}
    />
  ),
  notice(
    'notice-key-limit',
    <PaymentNotice kind="key-limit" action={{ onClick: record('new-key') }} />
  ),
  notice(
    'notice-daily-limit',
    <PaymentNotice
      kind="daily-limit"
      action={{ onClick: record('wallet-tip') }}
    />,
    'dialog'
  ),
  notice(
    'notice-tab-none',
    <PaymentNotice kind="tab-none" action={{ onClick: record('open-tab') }} />,
    'dialog'
  ),
  notice(
    'notice-tab-closing',
    <PaymentNotice
      kind="tab-closing"
      action={{ onClick: record('wallet-tip') }}
    />,
    'dialog'
  ),
  notice(
    'notice-settlement-delayed-reader',
    <PaymentNotice kind="settlement-delayed" audience="reader" />
  ),
  notice(
    'notice-settlement-delayed-writer',
    <PaymentNotice
      kind="settlement-delayed"
      audience="writer"
      action={{ onClick: record('settle-own') }}
    />
  ),
  notice(
    'notice-tips-unregistered',
    <PaymentNotice kind="tips-unavailable" reason="unregistered" />,
    'dialog'
  ),
  notice(
    'notice-tips-pending',
    <PaymentNotice kind="tips-unavailable" reason="pending" />,
    'dialog'
  ),
  notice(
    'notice-tips-payout-outdated',
    <PaymentNotice kind="tips-unavailable" reason="payout_outdated" />,
    'dialog'
  ),
  notice(
    'notice-tips-paused',
    <PaymentNotice kind="tips-unavailable" reason="paused" />,
    'dialog'
  ),
  notice(
    'notice-tips-splits',
    <PaymentNotice
      kind="tips-unavailable"
      reason="splits"
      action={{ onClick: record('wallet-tip') }}
    />,
    'dialog'
  ),
  notice(
    'notice-basket-item-unavailable',
    <PaymentNotice
      kind="basket-item-unavailable"
      action={{ onClick: record('remove') }}
    />,
    'dialog'
  ),
  notice(
    'notice-withdrawal-pending',
    <PaymentNotice
      kind="withdrawal-pending"
      unlockDate="Saturday 30 November"
    />
  ),
  notice(
    'notice-withdrawal-ready',
    <PaymentNotice
      kind="withdrawal-ready"
      amount="84000000"
      action={{ onClick: record('withdraw') }}
    />
  ),
  // A notice whose action is a link, as primary and as outline.
  notice(
    'notice-withdrawal-ready-link',
    <PaymentNotice
      kind="withdrawal-ready"
      amount="84000000"
      action={{ href: '#withdraw', emphasis: 'primary' }}
    />
  ),
  notice(
    'notice-key-none-link',
    <PaymentNotice
      kind="session-key-none"
      action={{ href: '#keys', emphasis: 'secondary' }}
    />
  ),
  notice(
    'notice-withdrawal-ready-long',
    <PaymentNotice
      kind="withdrawal-ready"
      amount="100001234567"
      action={{ onClick: record('withdraw') }}
    />
  ),
  notice(
    'notice-close-tab-warning',
    <PaymentNotice
      kind="close-tab-warning"
      action={{ label: 'Close tab', onClick: record('close-tab') }}
    />
  ),
  notice(
    'notice-nft-threshold',
    <PaymentNotice
      kind="nft-threshold"
      tipped="320000000"
      threshold="500000000"
    />
  ),
  notice('notice-network-busy', <PaymentNotice kind="network-busy" />),
  notice(
    'notice-refused',
    (() => {
      const refusal = refusalFromTabError('TAB_PRICE_UNAVAILABLE')
      return refusal.kind === 'refused' ? (
        <PaymentNotice kind="refused" copy={refusal.copy} />
      ) : null
    })(),
    'dialog'
  ),

  {
    id: 'key-rows',
    group: 'key',
    surface: 'page',
    render: () => (
      <div>
        <SessionKeyRow
          label="This browser"
          expiresAround="Thursday 26 December"
          used="32000000"
          limit="200000000"
          onRevoke={record('revoke')}
        />
        <SessionKeyRow
          label="Firefox on a work laptop"
          expired
          used="200000000"
          limit="200000000"
          onRevoke={record('revoke')}
          onRenew={record('renew-key')}
        />
        <SessionKeyRow label="Old phone" revoked used="0" limit="200000000" />
      </div>
    ),
  },

  // Worst realistic data for the newer pieces (break-ui).
  progress(
    'worst-result',
    'direct-tip',
    recordSource('MISMATCH', {
      mismatchReason: 'field:amount',
      needsReview: true,
    }),
    {
      txHash: HASH,
      summary: {
        amount: '92233720368547758',
        to: 'Aleksandra Wiśniewska-Kowalczyk and Bartholomew Fitzgerald-Montgomery III',
      },
      reference: 'jh7a9w2q8x0k4m6n1p3r5t7v9y2b4d6f',
      helpHref: '#help',
    }
  ),
  {
    id: 'worst-keys',
    group: 'key',
    surface: 'page',
    render: () => (
      <div>
        <SessionKeyRow
          label="Firefox 133 on Ubuntu 24.04 LTS (Aleksandra’s work laptop, third floor)"
          expiresAround="Wednesday 31 December"
          used="99999999999999"
          limit="100000000000000"
          onRevoke={record('revoke')}
        />
        <SessionKeyRow
          label="Jo"
          expired
          used="1"
          limit="1"
          onRenew={record('renew-key')}
        />
      </div>
    ),
  },
  {
    id: 'worst-basket',
    group: 'amount',
    surface: 'dialog',
    render: () => (
      <AmountSummary
        label="Total for 2 tips"
        total="123456789012"
        items={[
          {
            label:
              'Notes Toward a Natural History of Abandoned Railway Stations in the Polish Countryside',
            amount: '123456789011',
            status: 'sent-to-registered',
            note: 'Paid to the article’s updated payout address GBZX…MADI after the writer moved wallets.',
          },
          { label: 'Jo', amount: '1', status: 'under-review' },
        ]}
      />
    ),
  },
  {
    id: 'label-testnet',
    group: 'label',
    surface: 'page',
    render: () => (
      <div style={{ display: 'grid', gap: 12 }}>
        <TestnetLabel />
        <TestnetLabel detail />
      </div>
    ),
  },
  {
    id: 'label-status',
    group: 'label',
    surface: 'page',
    render: () => (
      <ul style={{ display: 'grid', gap: 8, listStyle: 'none', padding: 0 }}>
        {(Object.keys(STATUS_LABEL) as PaymentPhase[])
          .filter((phase) => !['simulating', 'signing'].includes(phase))
          .map((phase) => (
            <li key={phase}>
              <PaymentStatusLabel phase={phase} />
            </li>
          ))}
      </ul>
    ),
  },
]

function notice(
  id: string,
  node: ReactNode,
  surface: Surface = 'page'
): FixtureState {
  return { id, group: 'notice', surface, render: () => node }
}
