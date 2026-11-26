/**
 * Payment kit fixture. `?state=<id>` renders one state from `states.tsx`;
 * `?state=live-progress` and `?state=live-gate` are driven by the spec
 * through `window.__payments`; no parameter lists every state.
 * `&theme=dark` renders the dark palette.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { AmountSummary } from '../../../components/payments/AmountSummary'
import { TransactionProgress } from '../../../components/payments/TransactionProgress'
import { WalletGate } from '../../../components/payments/WalletGate'
import type {
  PaymentPhase,
  WalletGateState,
} from '../../../components/payments/payment-types'
import '../../../components/tipping/tipping.css'
import './fixture.css'
import { HASH, STATES, record, type Surface } from './states'

const params = new URLSearchParams(location.search)
const id = params.get('state')
if (params.get('theme') === 'dark')
  document.documentElement.classList.add('dark')

type Driver = {
  phase?: (phase: PaymentPhase) => void
  gate?: (state: WalletGateState) => void
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
  const [phase, setPhase] = useState<PaymentPhase | null>(null)
  useEffect(() => {
    driver.phase = setPhase
  }, [])
  return (
    <Frame surface="dialog">
      {/* Somewhere else to keep focus, as a reader does mid-article. */}
      <a href="#elsewhere" id="elsewhere">
        Elsewhere
      </a>
      <AmountSummary
        total="10000000"
        breakdown={[
          { label: 'To the author · 97.5%', amount: '9750000' },
          { label: 'Platform fee · 2.5%', amount: '250000' },
        ]}
      />
      {phase === null ? (
        <button
          type="button"
          className="pay-fixture-send"
          onClick={() => setPhase('simulating')}
        >
          Send tip
        </button>
      ) : (
        <TransactionProgress
          flow="direct-tip"
          phase={phase}
          txHash={['simulating', 'signing'].includes(phase) ? null : HASH}
          onRetry={() => {
            record('retry')()
            setPhase('simulating')
          }}
        />
      )}
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
  if (id === 'live-progress') return <LiveProgress />
  if (id === 'live-gate') return <LiveGate />
  const state = STATES.find((entry) => entry.id === id)
  if (!state) return <Index />
  return (
    <main className="pay-fixture" data-state-id={state.id}>
      <Frame surface={state.surface}>{state.render()}</Frame>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
