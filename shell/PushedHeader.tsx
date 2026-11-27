'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Icon } from '@/system/components/Icon'
import { BackIcon } from '@/system/icons'
import { firstPage } from './firstPage'

type PushedHeaderProps = {
  /** Where back goes when the screen was opened from outside (a shared
   * link, a new tab): the place it belongs to. */
  fallbackHref: string
  /** The words a screen reader hears: "Back to Today". */
  backLabel: string
  /** Actions at the end of the header (Share, More). */
  actions?: ReactNode
}

/**
 * The top of a pushed screen: a back control and, at the end, the screen's
 * actions. Back returns through history when the screen was reached inside
 * the application, so the place underneath gets its scroll position back;
 * opened from outside, it is a plain link to `fallbackHref`. It works with
 * no script (the link).
 */
export function PushedHeader({
  fallbackHref,
  backLabel,
  actions,
}: PushedHeaderProps) {
  const router = useRouter()
  return (
    <header className="qt-pushed__header">
      <Link
        href={fallbackHref}
        className="qt-icon-button"
        data-variant="plain"
        aria-label={backLabel}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return
          if (firstPage.navigated()) {
            event.preventDefault()
            router.back()
          }
        }}
      >
        <Icon icon={BackIcon} size={24} />
      </Link>
      {actions ? <div className="qt-pushed__actions">{actions}</div> : null}
    </header>
  )
}
