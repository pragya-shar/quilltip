import { createRoot } from 'react-dom/client'
import '../../../system/system.css'
import '../../../shell/shell.css'
import { ToastRegion } from '../../../system/components/ToastRegion'
import { AppShell } from '../../../shell/AppShell'
import { SheetHost } from '../../../shell/SheetHost'
import { SignOutWatch } from '../../../shell/SignOutWatch'
import {
  BalanceSourceContext,
  type BalanceReading,
} from '../../../shell/balance'
import { ResetPassword } from '../../../components/signin/ResetPassword'
import { SignInPage } from '../../../components/signin/SignInPage'
import { returnPathFrom } from '../../../lib/auth/returnPath'
import { useConvexAuth } from './fakeAuth'
import './afterSteps'
import { SignOutButton } from './SignOutButton'
import { TipStandIn } from './TipStandIn'

// Sign in inside the real application shell, with Convex Auth replaced by
// ./fakeAuth (the server resolves both auth imports there). What
// e2e/signin.spec.ts drives: /article (a tip control that needs sign-in)
// and /signin (the page's working part, as the server page renders it).

function useReading(): BalanceReading {
  const auth = useConvexAuth()
  return auth.isAuthenticated
    ? {
        auth: 'signed-in',
        available: { cents: 1840, display: '$18.40' },
        status: 'ready',
      }
    : { auth: 'signed-out', available: null, status: 'unavailable' }
}

const query = new URLSearchParams(location.search)
const pages: Record<string, () => React.ReactNode> = {
  '/article': () => <TipStandIn />,
  '/signin': () => (
    <div className="qt-page qt-signin-page">
      <SignInPage
        returnTo={returnPathFrom(query)}
        initialMode={query.get('mode') === 'create' ? 'create' : 'sign-in'}
      />
      <SignOutButton />
    </div>
  ),
}
pages['/signin/reset'] = () => (
  <div className="qt-page qt-signin-page">
    <h1 className="qt-heading" data-variant="title">
      Choose a new password
    </h1>
    <ResetPassword returnTo={returnPathFrom(query)} />
  </div>
)
const Page = pages[location.pathname] ?? pages['/article']!

createRoot(document.getElementById('root')!).render(
  <BalanceSourceContext.Provider value={useReading}>
    <AppShell
      beside={
        <>
          <SheetHost />
          <ToastRegion />
          <SignOutWatch />
        </>
      }
    >
      <Page />
    </AppShell>
  </BalanceSourceContext.Provider>
)
