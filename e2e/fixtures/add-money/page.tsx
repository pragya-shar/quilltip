import { useSyncExternalStore } from 'react'
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
import { AddMoneyServicesProvider } from '../../../components/pocket/money/services'
import { emulatedServices } from './emulated'
import { TipStandIn } from './TipStandIn'

// Add money, quick tips and turn off inside the real application shell and
// sheet host, on an emulated wallet and network (./emulated.ts), with no
// backend: what e2e/add-money.spec.ts drives. `/` is an article with a
// chosen line and a stand-in for the tip bar; `/balance` is the balance's
// Add money button and its quick tips section.
document.documentElement.setAttribute('data-session', 'held')
const reading: BalanceReading = {
  auth: 'signed-in',
  available: null,
  status: 'ready',
}
const useFakeBalance = () => reading

function Root() {
  useSyncExternalStore(
    (l) => {
      window.addEventListener('popstate', l)
      return () => window.removeEventListener('popstate', l)
    },
    () => location.pathname
  )
  return (
    <TipStandIn
      place={location.pathname === '/balance' ? 'balance' : 'article'}
    />
  )
}

createRoot(document.getElementById('root')!).render(
  <BalanceSourceContext.Provider value={useFakeBalance}>
    <AddMoneyServicesProvider services={emulatedServices}>
      <AppShell
        beside={
          <>
            <SheetHost />
            <ToastRegion />
          </>
        }
      >
        <Root />
      </AppShell>
    </AddMoneyServicesProvider>
  </BalanceSourceContext.Provider>
)
