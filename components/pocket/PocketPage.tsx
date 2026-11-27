'use client'

import { useSearchParams } from 'next/navigation'
import { Pocket } from './Pocket'

/**
 * The Pocket as a page's content: where a link to it lands, and where the
 * balance item goes on a desktop link or with no script. `?receipt=` (a
 * row's own link) opens that row's receipt once the activity has loaded.
 */
export function PocketPage() {
  const receipt = useSearchParams()?.get('receipt') ?? undefined
  return (
    <div className="qt-pocket-page__live">
      <Pocket headingLevel={2} initialReceipt={receipt} />
    </div>
  )
}
