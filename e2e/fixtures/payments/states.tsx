/**
 * Every state of the payment kit, by id. The fixture page renders one with
 * `?state=<id>`; the spec and the screenshot run iterate this list.
 */
import type { ReactNode } from 'react'
import { AmountSummary } from '../../../components/payments/AmountSummary'
import { PaymentNotice } from '../../../components/payments/PaymentNotice'
import { PaymentStatusLabel } from '../../../components/payments/PaymentStatusLabel'
import { TestnetLabel } from '../../../components/payments/TestnetLabel'
import { TransactionProgress } from '../../../components/payments/TransactionProgress'
import { WalletGate } from '../../../components/payments/WalletGate'
import type {
  PaymentFlow,
  PaymentPhase,
  WalletGateState,
} from '../../../components/payments/payment-types'
import { STATUS_LABEL } from '../../../lib/copy/payment-states'
import {
  PAYMENT_FLOWS,
  failureFromContract,
  failureFromWalletError,
} from '../../../lib/payments/ui-state'
import { WalletError } from '../../../lib/stellar/v2/wallet-errors'

export type Surface = 'dialog' | 'page'

export type FixtureState = {
  id: string
  group: 'gate' | 'progress' | 'result' | 'amount' | 'notice' | 'label'
  surface: Surface
  render: () => ReactNode
}

export const HASH =
  '9f2c4b1e7a3d5c6b8e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d'
const ADDRESS = 'GBZX…NMADI'

/** Calls the fixture records, so the spec can assert what a button did. */
export function record(name: string) {
  return () => {
    const log = ((window as unknown as { __calls?: string[] }).__calls ??= [])
    log.push(name)
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

function progress(
  id: string,
  flow: PaymentFlow,
  phase: PaymentPhase,
  extra: Partial<Parameters<typeof TransactionProgress>[0]> = {}
): FixtureState {
  const result = !['simulating', 'signing', 'sending', 'checking'].includes(
    phase
  )
  return {
    id,
    group: result ? 'result' : 'progress',
    surface: flow.startsWith('tab') || flow === 'collect' ? 'page' : 'dialog',
    render: () => (
      <TransactionProgress
        flow={flow}
        phase={phase}
        txHash={['simulating', 'signing'].includes(phase) ? null : HASH}
        onRetry={record('retry')}
        {...extra}
      />
    ),
  }
}

const LONG_ERROR = failureFromContract({
  code: null,
  name: null,
  message:
    'Stellar refused the transaction because the account sequence number moved while the wallet was signing, the fee bid was below the surge price for ledger 51234567, and the footprint for contract CAFCGOIM6SKVBWCPFQODN22MY5HUJEJMW5AOMNGAOVZ4QBLJJ5RLOOMS was archived and had to be restored first.',
})

export const STATES: FixtureState[] = [
  gate('gate-signed-out', { kind: 'signed-out' }),
  gate('gate-no-wallet', { kind: 'no-wallet' }),
  gate('gate-disconnected', { kind: 'disconnected' }),
  gate('gate-locked', { kind: 'locked' }),
  gate('gate-wrong-network', {
    kind: 'wrong-network',
    walletNetwork: 'Mainnet',
  }),
  gate('gate-unverified', { kind: 'unverified', address: ADDRESS }),
  gate('gate-checking', { kind: 'checking' }),
  gate('gate-busy', { kind: 'disconnected' }, true),
  gate('gate-ready', { kind: 'ready' }),

  progress('progress-simulating', 'direct-tip', 'simulating'),
  progress('progress-signing', 'direct-tip', 'signing'),
  progress('progress-sending', 'direct-tip', 'sending'),
  progress('progress-checking', 'direct-tip', 'checking'),
  progress('progress-checking-slow', 'direct-tip', 'checking', {
    slow: true,
  }),
  progress('result-sent-to-registered', 'direct-tip', 'sent-to-registered'),
  progress('result-under-review', 'direct-tip', 'under-review'),
  progress('result-failed', 'direct-tip', 'failed'),
  progress('result-failed-wallet', 'direct-tip', 'failed', {
    failure: failureFromWalletError(new WalletError('rejected', '')),
  }),
  progress('result-failed-long', 'direct-tip', 'failed', {
    failure: LONG_ERROR,
  }),
  progress('result-expired', 'direct-tip', 'expired'),
  progress('tab-tip-sending', 'tab-tip', 'sending'),
  progress('tab-tip-accepted', 'tab-tip', 'accepted'),
  progress('tab-tip-settled', 'tab-tip', 'settled'),
  progress('tab-tip-shortfall', 'tab-tip', 'shortfall'),
  progress('tab-tip-unpaid', 'tab-tip', 'unpaid'),
  progress('tab-tip-void-reset', 'tab-tip', 'void-reset'),
  ...PAYMENT_FLOWS.filter((flow) => flow !== 'tab-tip').map((flow) =>
    progress(`confirmed-${flow}`, flow, 'confirmed')
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
          { label: 'To the author · 97.5%', amount: '9750000' },
          { label: 'Platform fee · 2.5%', amount: '250000' },
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
            label:
              'To Margarethe Josephine Abernathy-Castellanos, co-author · 48.75%',
            amount: '48750000000',
          },
          { label: 'To the author · 48.75%', amount: '48750000001' },
          { label: 'Platform fee · 2.5%', amount: '2500000000' },
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
          { label: 'The words we keep', amount: '10000000' },
          {
            label: '“A passage about rivers that ran backwards”',
            amount: '5000000',
          },
          { label: 'Notes from a cold harbour', amount: '20000000' },
        ]}
        breakdown={[
          { label: 'To the authors · 97.5%', amount: '34125000' },
          { label: 'Platform fee · 2.5%', amount: '875000' },
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
          { label: 'To the authors · 97.5%', amount: '975000000' },
          { label: 'Platform fee · 2.5%', amount: '25000000' },
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
    'notice-tips-splits',
    <PaymentNotice
      kind="tips-unavailable"
      reason="splits"
      action={{ onClick: record('wallet-tip') }}
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
  notice(
    'notice-withdrawal-ready-long',
    <PaymentNotice
      kind="withdrawal-ready"
      amount="100001234567"
      action={{ onClick: record('withdraw') }}
    />
  ),
  notice('notice-network-busy', <PaymentNotice kind="network-busy" />),

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
          .filter(
            (phase) => !['simulating', 'signing', 'sending'].includes(phase)
          )
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
