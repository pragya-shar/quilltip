/**
 * Payment kit fixture. `?state=<id>` renders one state from `states.tsx`;
 * `?state=live-progress`, `?state=live-gate` and `?state=live-notice` are
 * driven by the spec through `window.__payments`; no parameter lists every
 * state. `&theme=dark` renders the dark palette; `&surface=page` renders the
 * live progress on a page surface instead of the tip dialog;
 * `&surface=dashboard` renders any state on the dashboard surface, which
 * stays light in dark appearance.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AmountSummary } from '../../../components/payments/AmountSummary'
import { PaymentNotice } from '../../../components/payments/PaymentNotice'
import { TransactionProgress } from '../../../components/payments/TransactionProgress'
import { WalletGate } from '../../../components/payments/WalletGate'
import type {
  PaymentPhase,
  ProgressSource,
  WalletGateState,
} from '../../../components/payments/payment-types'
import '../../../components/account/account.css'
import '../../../components/tipping/tipping.css'
import './fixture.css'
import { HASH, STATES, record, sourceForPhase, type Surface } from './states'

const params = new URLSearchParams(location.search)
const id = params.get('state')
if (params.get('theme') === 'dark')
  document.documentElement.classList.add('dark')

type Driver = {
  /** Sets the record (and client state) that produces this phase. */
  phase?: (phase: PaymentPhase) => void
  source?: (source: ProgressSource) => void
  gate?: (state: WalletGateState) => void
  notice?: (shown: boolean) => void
}
const driver: Driver = {}
;(window as unknown as { __payments: Driver }).__payments = driver

function Frame({
  surface,
  children,
}: {
  surface: Surface
  children: ReactNode
}) {
  if (params.get('surface') === 'dashboard') {
    // The markup of AccountSurface, without the app chrome.
    return (
      <div className="account-surface ui-light pay-fixture-account">
        <section
          className="account-folio"
          aria-label="Fixture"
          data-surface="dashboard"
        >
          <h2>Your tab</h2>
          {children}
        </section>
      </div>
    )
  }
  if (surface === 'dialog') {
    // The tip dialog's surface and tokens, without the modal behaviour.
    return (
      <section
        className="tip-dialog pay-fixture-dialog"
        aria-label="Fixture"
        data-surface="dialog"
      >
        <h2>Support the writer</h2>
        {children}
      </section>
    )
  }
  return (
    <section className="pay-fixture-page" aria-label="Fixture">
      <h2 className="pay-fixture-heading">Your tab</h2>
      {children}
    </section>
  )
}

function LiveProgress() {
  const [source, setSource] = useState<ProgressSource | null>(null)
  const surface: Surface = params.get('surface') === 'page' ? 'page' : 'dialog'
  useEffect(() => {
    driver.source = setSource
    driver.phase = (phase) => setSource(sourceForPhase(phase))
  }, [])
  const hasHash =
    source !== null && 'record' in source && source.record.status !== 'PREPARED'
  return (
    <Frame surface={surface}>
      {/* Somewhere else to keep focus, as a reader does mid-article. */}
      <a href="#elsewhere" id="elsewhere">
        Elsewhere
      </a>
      <AmountSummary
        total="10000000"
        breakdown={[
          { label: 'To the author', amount: '9750000' },
          { label: 'Platform fee', amount: '250000' },
        ]}
      />
      {source === null ? (
        <button
          type="button"
          className="pay-fixture-send"
          onClick={() => setSource(sourceForPhase('simulating'))}
        >
          Send tip
        </button>
      ) : (
        <TransactionProgress
          flow="direct-tip"
          source={source}
          startedByUser
          txHash={hasHash ? HASH : null}
          summary={{ amount: '10000000', to: 'Ada Lovelace' }}
          onCancel={record('cancel')}
          onRetry={() => {
            record('retry')()
            setSource(sourceForPhase('simulating'))
          }}
        />
      )}
    </Frame>
  )
}

function LiveNotice() {
  const [shown, setShown] = useState(false)
  useEffect(() => {
    driver.notice = setShown
  }, [])
  return (
    <Frame surface="dialog">
      <button
        type="button"
        className="pay-fixture-send"
        onClick={() => setShown(true)}
      >
        Send tip
      </button>
      {shown ? <PaymentNotice kind="paused" announce /> : null}
    </Frame>
  )
}

function LiveGate() {
  const [state, setState] = useState<WalletGateState>({
    kind: 'disconnected',
  })
  useEffect(() => {
    driver.gate = setState
  }, [])
  return (
    <Frame surface="dialog">
      <WalletGate
        state={state}
        onConnect={record('connect')}
        onRecheck={record('recheck')}
        onInstall={record('install')}
        onVerify={record('verify')}
        onSignIn={record('sign-in')}
      >
        <button type="button" className="pay-fixture-send">
          Send tip
        </button>
      </WalletGate>
    </Frame>
  )
}

function Index() {
  return (
    <main className="pay-fixture-index">
      <h1>Payment kit states</h1>
      <ul>
        {STATES.map((state) => (
          <li key={state.id}>
            <a href={`?state=${state.id}`}>{state.id}</a>
          </li>
        ))}
      </ul>
    </main>
  )
}

function Fixture() {
  // The root's effect runs after every child's effect in the first commit,
  // so the spec can wait for this instead of a fixed time.
  useEffect(() => {
    document.body.dataset.settled = 'true'
  }, [])
  if (id === 'live-progress') return <LiveProgress />
  if (id === 'live-gate') return <LiveGate />
  if (id === 'live-notice') return <LiveNotice />
  const state = STATES.find((entry) => entry.id === id)
  if (!state) return <Index />
  return (
    <main className="pay-fixture" data-state-id={state.id}>
      <Frame surface={state.surface}>{state.render()}</Frame>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
