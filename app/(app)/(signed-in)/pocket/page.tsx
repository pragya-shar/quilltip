import type { Metadata } from 'next'
import { Button } from '@/system/components/Button'
import { Heading } from '@/system/components/Heading'
import { POCKET } from '@/shell/navigation'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'
import { PocketPage } from '@/components/pocket/PocketPage'

export const metadata: Metadata = {
  title: 'Balance',
  robots: { index: false, follow: false },
}

/** With no script the figures cannot load: the page hides their place and
 * says so, instead of holding skeletons that never fill. */
const NO_SCRIPT_STYLE = '.qt-pocket-page__live{display:none}'

/**
 * The balance as a page: where a link to it lands, and where the balance
 * item goes with no script. In the application the item opens it as a
 * sheet (phone) or a right panel (desktop) instead, over the current page.
 * The title and the explanation are in the server HTML; the figures are an
 * enhancement that needs the payments code.
 */
export default function PocketRoute() {
  return (
    <PushedScreen>
      <PushedHeader fallbackHref="/" backLabel="Back to Today" />
      <div className="qt-page qt-pocket-page">
        <Heading level={1} variant="title">
          Balance
        </Heading>
        <noscript>
          <style>{NO_SCRIPT_STYLE}</style>
          <div className="qt-pocket-page__noscript">
            <p className="qt-pocket__plain">
              Your balance, your earnings and your tips show here when
              JavaScript is on. Reading articles works without it.
            </p>
            <Button variant="primary" href={POCKET.signIn}>
              Sign in
            </Button>
            <p className="qt-testnet">Testnet. Practice money only.</p>
          </div>
        </noscript>
        <PocketPage />
      </div>
    </PushedScreen>
  )
}
