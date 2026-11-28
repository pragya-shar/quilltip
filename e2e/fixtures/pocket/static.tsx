import { renderToString } from 'react-dom/server'
import { AppShell } from '../../../shell/AppShell'
import { BalanceSourceContext } from '../../../shell/balance'
import PocketRoute from '../../../app/(app)/(signed-in)/pocket/page'

// /pocket as the server sends it before any script: auth is not known yet
// (Convex Auth decides in the browser), so the balance source is loading.
const loading = () =>
  ({ auth: 'loading', available: null, status: 'loading' }) as const

export function renderPocket(): string {
  return renderToString(
    <BalanceSourceContext.Provider value={loading}>
      <AppShell>
        <PocketRoute />
      </AppShell>
    </BalanceSourceContext.Provider>
  )
}
