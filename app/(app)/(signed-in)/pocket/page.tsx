import type { Metadata } from 'next'
import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { Heading } from '@/system/components/Heading'
import { PocketContent } from '@/components/pocket/PocketContent'
import { POCKET } from '@/shell/navigation'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'
import { BalanceIcon } from '@/system/icons'

export const metadata: Metadata = {
  title: 'Balance',
  robots: { index: false, follow: false },
}

/** With no script nobody is signed in, and who is here is never known:
 * the waiting figure goes, and the page asks the person to sign in. */
const NO_SCRIPT_STYLE = '.qt-pocket[aria-busy="true"]{display:none}'

/**
 * The Pocket as a page: where a link to it lands, and where the balance item
 * goes with no script. In the application the item opens the Pocket as a
 * sheet (phone) or a panel (desktop) instead.
 */
export default function PocketPage() {
  return (
    <PushedScreen>
      <PushedHeader fallbackHref="/" backLabel="Back to Today" />
      <div className="qt-page qt-placeholder">
        <Heading level={1} variant="title">
          Balance
        </Heading>
        <PocketContent />
        <noscript>
          <style>{NO_SCRIPT_STYLE}</style>
          <div className="qt-pocket">
            <EmptyState
              icon={BalanceIcon}
              title="Sign in to tip and keep your lines."
              action={
                <Button variant="primary" href={POCKET.signIn}>
                  Sign in
                </Button>
              }
            />
          </div>
        </noscript>
      </div>
    </PushedScreen>
  )
}
