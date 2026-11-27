'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'
import { Icon } from '@/system/components/Icon'
import { BackIcon } from '@/system/icons'
import { appHistory } from './appHistory'

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
 * actions. Back returns through history when the entry behind is a page of
 * the application (shell/appHistory.ts), so the place underneath gets its
 * scroll position back; otherwise (opened from outside, or after the
 * browser's Back took the visit to the first page) it is a plain link to
 * `fallbackHref`, and never leaves the site. It works with no script.
 */
export function PushedHeader({
  fallbackHref,
  backLabel,
  actions,
}: PushedHeaderProps) {
  const router = useRouter()
  return (
    <header className="qt-pushed__header">
      {/* No prefetch: inside the application back goes through history, and
          this link is taken only when the screen was opened from outside. */}
      <Link
        href={fallbackHref}
        prefetch={false}
        className="qt-icon-button"
        data-variant="plain"
        aria-label={backLabel}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return
          // Through history only when the entry behind is ours.
          if (appHistory.canGoBack()) {
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
