import type { Metadata } from 'next'
import { Heading } from '@/system/components/Heading'
import { PocketContent } from '@/shell/pocket/PocketContent'
import { PushedScreen } from '@/shell/PushedScreen'

export const metadata: Metadata = {
  title: 'Balance',
  robots: { index: false, follow: false },
}

/**
 * The Pocket as a page: where a link to it lands, and where the balance item
 * goes with no script. In the application the item opens the Pocket as a
 * sheet (phone) or a panel (desktop) instead.
 */
export default function PocketPage() {
  return (
    <PushedScreen>
      <div className="qt-page qt-placeholder">
        <Heading level={1} variant="title">
          Balance
        </Heading>
        <PocketContent />
      </div>
    </PushedScreen>
  )
}
