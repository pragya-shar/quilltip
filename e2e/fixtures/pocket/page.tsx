import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import '../../../system/system.css'
import '../../../shell/shell.css'
import { ToastRegion } from '../../../system/components/ToastRegion'
import { AppShell } from '../../../shell/AppShell'
import { sheetStack } from '../../../shell/sheetStack'
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
} from '../../../lib/pocket/source'
import type {
  ActivityItem,
  ActivityView,
  EarningsView,
  Money,
} from '../../../lib/pocket/types'
import {
  SCENARIOS,
  elsewhereTip,
  exactCents,
  scenario,
  tokenAmount,
  type Role,
  type Scenario,
} from './scenarios'
import { AddMoneyServicesProvider } from '../../../components/pocket/money/services'
import { emulatedServices } from '../add-money/emulated'
import { ArticleStandIn } from './ArticleStandIn'
import { ElsewherePage } from './ElsewherePage'
import { TodayStandIn } from './TodayStandIn'

// The balance inside the real application shell, on the money layer's own
// fake scenarios (./scenarios), with no backend: what
// e2e/pocket.spec.ts drives. The address picks the money:
//   ?scenario=  one of SCENARIOS (default ready)
//   ?role=      both (default), reader, writer
//   ?auth=      signed-in (default), signed-out, loading
//   ?act=       add, add-fail, withdraw, withdraw-fail: a stand-in money
//               act, to drive the sheets' phases and focus. Add money's
//               own sheet runs on the emulated wallet and network
//               (e2e/fixtures/add-money/emulated.ts).
//   ?paged      lists come in pages of two ("Show more")
//   ?earnings=, ?earnings-later=  loading or unavailable, from the start
//               or after a first answer
//   ?writer-converted, ?unwired  see below
//   ?open=      a declared sheet to open on load (withdraw, add-money), as a
//               later caller might, whatever the balance offers
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
// As the root layout's pre-paint script does: a session token is held
// unless this visit is signed out (?held=no: signed out with no token).
if (auth !== 'signed-out' || params.get('held') === 'yes')
  document.documentElement.setAttribute('data-session', 'held')
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
// converted at today's price: two decimals and the flag; the figure adds
// the approximate mark.
const base = scenario(name, NOW, role)
const approx = (figure: Money | null): Money | null =>
  figure && {
    cents: figure.cents,
    display: `$${(Math.floor(figure.cents + 1e-9) / 100).toFixed(2)}`,
    converted: true,
  }
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

/**
 * `?paged`: each list comes from the server in pages of two. Pressing "Show
 * more" sets `loadingMore` (and `canLoadMore` false, as the money layer
 * does; never both true) until the next page arrives.
 */
function usePaged(view: ActivityView): ActivityView {
  const [shown, setShown] = useState(2)
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!loading) return
    const id = window.setTimeout(() => {
      setShown((n) => n + 2)
      setLoading(false)
    }, 500)
    return () => window.clearTimeout(id)
  }, [loading])
  if (!params.has('paged') || view.status !== 'ready') return view
  return {
    ...view,
    items: view.items.slice(0, shown),
    canLoadMore: !loading && view.items.length > shown,
    loadingMore: loading,
    loadMore: () => setLoading(true),
  }
}

/**
 * `?earnings=loading|unavailable`: earnings in that state from the start.
 * `?earnings-later=loading|unavailable`: earnings answer first, then fall
 * into that state, as when figures reload or the server stops answering.
 */
function useEarningsState(view: EarningsView): EarningsView {
  const later = params.get('earnings-later')
  const [fallen, setFallen] = useState(false)
  useEffect(() => {
    if (!later) return
    const id = window.setTimeout(() => setFallen(true), 400)
    return () => window.clearTimeout(id)
  }, [later])
  const state = params.get('earnings') ?? (fallen ? later : null)
  if (state === 'loading' || state === 'unavailable')
    return {
      ...view,
      status: state,
      pending: null,
      available: null,
      collected: null,
      total: null,
      onHold: null,
      notPaid: null,
      counts: null,
      exact: null,
      isWriter: null,
    }
  return view
}

const source: PocketSource = {
  useWired: () => !params.has('unwired'),
  format: { money: exactCents, token: tokenAmount },
  useBalance: () => views.balance,
  useEarnings: () => useEarningsState(views.earnings),
  useActivity: (side) => {
    const server = useSyncExternalStore(subscribeServer, readServer)
    const base = side === 'reader' ? views.reader : views.writer
    const merged = useMemo(() => {
      if (side !== 'reader' || base.status !== 'ready') return base
      const extra = JSON.parse(server) as ActivityItem[]
      return { ...base, items: [...extra, ...base.items] }
    }, [base, server, side])
    return usePaged(merged)
  },
  useAddMoney: () => {
    const act = useFakeAct(
      'Add $10',
      'Adding $10',
      '$10 added to your balance',
      actKind === 'add-fail'
    )
    return actKind === 'add' || actKind === 'add-fail' ? act : null
  },
  useWithdraw: () => {
    const act = useFakeAct(
      'Withdraw $0.6825',
      'Withdrawing $0.6825',
      '$0.6825 sent to your wallet',
      actKind === 'withdraw-fail'
    )
    return actKind === 'withdraw' || actKind === 'withdraw-fail' ? act : null
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
    <AddMoneyServicesProvider services={emulatedServices}>
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
    </AddMoneyServicesProvider>
  </BalanceSourceContext.Provider>
)

// `?open=`: a declared sheet opened directly, after the page has rendered.
const openOnLoad = params.get('open')
if (openOnLoad) window.setTimeout(() => sheetStack.open(openOnLoad), 300)
