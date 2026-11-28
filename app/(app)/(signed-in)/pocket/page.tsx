import type { Metadata } from 'next'
import { Button } from '@/system/components/Button'
import { EmptyState } from '@/system/components/EmptyState'
import { Heading } from '@/system/components/Heading'
import { BalanceIcon } from '@/system/icons'
import { POCKET } from '@/shell/navigation'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'
import { PocketPageLoader } from '@/components/pocket/PocketPageLoader'

export const metadata: Metadata = {
  title: 'Balance',
  robots: { index: false, follow: false },
}

/**
 * The balance as a page: where a link to it lands, and where the balance
 * item goes with no script. In the application the item opens it as a
 * sheet (phone) or a right panel (desktop) instead, over the current page.
 * The title is in the server HTML, with the balance's reserved space when a
 * session token is held (its figures need the payments code) and a way to
 * sign in otherwise.
 */
export default function PocketRoute() {
  return (
    <PushedScreen>
      <PushedHeader fallbackHref="/" backLabel="Back to Today" />
      <div className="qt-page qt-placeholder" data-session-switch="">
        <Heading level={1} variant="title">
          Balance
        </Heading>
        {/* Who is here is known only after a script runs. Until then, and
            with no script, the page asks to sign in, unless the pre-paint
            script saw a session token (data-session="held"): then the
            balance shows, waiting neutrally while auth loads. */}
        <div data-when="held">
          <PocketPageLoader />
        </div>
        <div className="qt-pocket" data-when="signed-out">
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
      </div>
    </PushedScreen>
  )
}
