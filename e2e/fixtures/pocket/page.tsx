import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../system/system.css'
import '../../../shell/shell.css'
import { ToastRegion } from '../../../system/components/ToastRegion'
import { AppShell } from '../../../shell/AppShell'
import { SheetHost } from '../../../shell/SheetHost'
import {
  BalanceSourceContext,
  type BalanceReading,
} from '../../../shell/balance'
import PocketRoute from '../../../app/(app)/(signed-in)/pocket/page'
import {
  PocketSourceContext,
  type MoneyAct,
  type MoneyActPhase,
  type PocketSource,
} from '../../../components/pocket/source'
import type { ActivityItem, Money } from '../../../components/pocket/types'
import {
  SCENARIOS,
  elsewhereTip,
  exactCents,
  forRole,
  scenario,
  tokenAmount,
  type Role,
  type Scenario,
} from './scenarios'
import { ArticleStandIn } from './ArticleStandIn'
import { ElsewherePage } from './ElsewherePage'
import { TodayStandIn } from './TodayStandIn'

// The Pocket inside the real application shell, with no backend: what
// e2e/pocket.spec.ts drives. The address picks the money:
//   ?scenario=  one of SCENARIOS (default ready)
//   ?role=      both (default), reader, writer
//   ?auth=      signed-in (default), signed-out, loading
//   ?act=       add, add-fail, withdraw: a stand-in money act, to drive the
//               sheets' phases and focus (no such act ships yet)
// Tips "sent elsewhere" (/elsewhere) are kept in localStorage as the
// fixture's server, so they survive a reload the way the server's do.

const params = new URLSearchParams(location.search)
const name = (
  SCENARIOS.includes(params.get('scenario') as Scenario)
    ? params.get('scenario')
    : 'ready'
) as Scenario
const role = (params.get('role') ?? 'both') as Role
const auth = (params.get('auth') ?? 'signed-in') as BalanceReading['auth']
const actKind = params.get('act')

const SERVER_KEY = 'pocket-fixture:server'
const readServer = (): string => localStorage.getItem(SERVER_KEY) ?? '[]'
const subscribeServer = (onChange: () => void) => {
  window.addEventListener('storage', onChange)
  window.addEventListener('pocket-fixture:server', onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener('pocket-fixture:server', onChange)
  }
}
export function sendElsewhere() {
  const rows = JSON.parse(readServer()) as ActivityItem[]
  if (!rows.some((row) => row.requestId === 'request-elsewhere'))
    rows.push(elsewhereTip(Date.now()))
  localStorage.setItem(SERVER_KEY, JSON.stringify(rows))
  window.dispatchEvent(new Event('pocket-fixture:server'))
}

const NOW = Date.now()
// `?writer-converted`: the money layer marks the writer's figures as
// converted at today's price, written "≈" with two decimals.
const base = forRole(scenario(name, NOW), role)
const approx = (figure: Money | null): Money | null =>
  figure && {
    cents: figure.cents,
    display: `≈ $${(Math.floor(figure.cents + 1e-9) / 100).toFixed(2)}`,
    converted: true,
  }
// `?no-price`: the money layer has no price for the figure.
if (params.has('no-price')) base.balance = { ...base.balance, price: null }
const views =
  params.has('writer-converted') && base.earnings.status === 'ready'
    ? {
        ...base,
        earnings: {
          ...base.earnings,
          available: approx(base.earnings.available),
          pending: approx(base.earnings.pending),
          collected: approx(base.earnings.collected),
        },
      }
    : base

function useFakeAct(
  label: string,
  working: string,
  ok: string,
  fail: boolean
): MoneyAct {
  const [state, setState] = useState<MoneyActPhase>({ phase: 'idle' })
  useEffect(() => {
    if (state.phase !== 'working') return
    const id = window.setTimeout(
      () =>
        setState(
          fail
            ? {
                phase: 'failed',
                reason: 'That did not go through. Nothing was added.',
              }
            : { phase: 'done', result: ok }
        ),
      600
    )
    return () => window.clearTimeout(id)
  }, [state, fail, ok])
  return {
    label,
    state,
    start: () => setState({ phase: 'working', status: working }),
    reset: () => setState({ phase: 'idle' }),
  }
}

const source: PocketSource = {
  format: { exactCents, token: tokenAmount },
  useBalance: () => views.balance,
  useEarnings: () => views.earnings,
  useActivity: (side) => {
    const server = useSyncExternalStore(subscribeServer, readServer)
    const base = side === 'reader' ? views.reader : views.writer
    return useMemo(() => {
      if (side !== 'reader' || base.status !== 'ready') return base
      const extra = JSON.parse(server) as ActivityItem[]
      return { ...base, items: [...extra, ...base.items] }
    }, [base, server, side])
  },
  useAddMoney: () => {
    const act = useFakeAct(
      'Add $5 practice money',
      'Adding $5',
      '$5 added to your balance',
      actKind === 'add-fail'
    )
    return actKind === 'add' || actKind === 'add-fail' ? act : null
  },
  useWithdraw: () => {
    const act = useFakeAct(
      'Withdraw $0.6825',
      'Withdrawing $0.6825',
      '$0.6825 sent to your wallet',
      false
    )
    return actKind === 'withdraw' ? act : null
  },
}

const reading: BalanceReading = {
  auth,
  available: views.balance.available,
  status:
    views.balance.status === 'ready' || views.balance.status === 'none'
      ? 'ready'
      : views.balance.status === 'loading'
        ? 'loading'
        : 'unavailable',
}
const useFakeBalance = () => reading

const pages: Record<string, () => React.ReactNode> = {
  '/': () => <TodayStandIn />,
  '/article': () => <ArticleStandIn />,
  '/pocket': () => <PocketRoute />,
  '/elsewhere': () => <ElsewherePage onSend={sendElsewhere} />,
}
const Page = pages[location.pathname] ?? pages['/']!

createRoot(document.getElementById('root')!).render(
  <BalanceSourceContext.Provider value={useFakeBalance}>
    <PocketSourceContext.Provider value={source}>
      <AppShell
        beside={
          <>
            <SheetHost />
            <ToastRegion />
          </>
        }
      >
        <Page />
      </AppShell>
    </PocketSourceContext.Provider>
  </BalanceSourceContext.Provider>
)
