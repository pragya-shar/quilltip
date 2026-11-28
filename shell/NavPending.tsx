'use client'

import { useLinkStatus } from 'next/link'

/**
 * Inside a navigation link: a quiet mark while the next page loads, so the
 * current page stays on screen (nothing blanks) and the tap is answered.
 */
export function NavPending() {
  const { pending } = useLinkStatus()
  return (
    <span
      className="qt-nav__pending"
      data-pending={pending || undefined}
      aria-hidden="true"
    />
  )
}
