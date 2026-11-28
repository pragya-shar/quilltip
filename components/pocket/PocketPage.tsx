'use client'

import { LocalPaymentsShell } from './LocalPaymentsShell'
import { Pocket } from './Pocket'

/**
 * The balance as a page's content: where a link to /pocket lands, and where
 * the balance item goes with no script (where this region stays hidden and
 * the page explains itself instead).
 */
export function PocketPage() {
  return (
    <div className="qt-pocket-page__live">
      <LocalPaymentsShell />
      <Pocket headingLevel={2} />
    </div>
  )
}
