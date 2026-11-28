import { renderToString } from 'react-dom/server'
import { AppShell } from '../../../shell/AppShell'
import { BalanceSourceContext } from '../../../shell/balance'
import SignInRoute from '../../../app/(app)/(public)/signin/page'

// /signin as the server sends it before any script, from the real route.
const loading = () =>
  ({ auth: 'loading', available: null, status: 'loading' }) as const

export async function renderSignIn(
  query: Record<string, string>
): Promise<string> {
  const page = await SignInRoute({ searchParams: Promise.resolve(query) })
  return renderToString(
    <BalanceSourceContext.Provider value={loading}>
      <AppShell>{page}</AppShell>
    </BalanceSourceContext.Provider>
  )
}
