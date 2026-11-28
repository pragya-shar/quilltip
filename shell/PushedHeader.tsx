'use client'

import { AppLink as Link } from '@/system/components/AppLink'
import { useRouter } from 'next/navigation'
import { useRef, type ReactNode } from 'react'
import { Icon } from '@/system/components/Icon'
import { BackIcon, CloseIcon } from '@/system/icons'
import { appHistory } from './appHistory'

/** How long `onBack` may take before the screen leaves anyway. */
export const ON_BACK_LIMIT_MS = 800

type PushedHeaderProps = {
  /** Where back goes when the screen was opened from outside (a shared
   * link, a new tab): the place it belongs to. */
  fallbackHref: string
  /** The words a screen reader hears: "Back to Today", "Close the editor". */
  backLabel: string
  /** `close`: an X in place of the back arrow, for a screen that is a task
   * (the editor) rather than a step down. Default `back`. */
  variant?: 'back' | 'close'
  /** Runs before the screen leaves (the editor stores its draft on the
   * device). It may be async; the screen leaves after it settles, or after
   * `ON_BACK_LIMIT_MS`, whichever comes first, and even if it throws. */
  onBack?: () => void | Promise<void>
  /** Actions at the end of the header (Share, More). */
  actions?: ReactNode
}

/**
 * The top of a pushed screen: a back (or Close) control and, at the end,
 * the screen's actions. Back returns through history when the entry behind
 * is a page of the application (shell/appHistory.ts), so the place
 * underneath gets its scroll position back; otherwise (opened from outside,
 * or after the browser's Back took the visit to the first page) it goes to
 * `fallbackHref`, and never leaves the site. It works with no script (a
 * plain link; `onBack` then cannot run).
 */
export function PushedHeader({
  fallbackHref,
  backLabel,
  variant = 'back',
  onBack,
  actions,
}: PushedHeaderProps) {
  const router = useRouter()
  const leaving = useRef(false)
  const leave = () => {
    if (appHistory.canGoBack()) router.back()
    else router.push(fallbackHref)
  }
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
          if (!onBack) {
            // Through history only when the entry behind is ours.
            if (appHistory.canGoBack()) {
              event.preventDefault()
              router.back()
            }
            return
          }
          event.preventDefault()
          if (leaving.current) return
          leaving.current = true
          let timer: ReturnType<typeof setTimeout> | undefined
          void Promise.race([
            Promise.resolve()
              .then(onBack)
              .catch(() => {}),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, ON_BACK_LIMIT_MS)
            }),
          ]).then(() => {
            clearTimeout(timer)
            leaving.current = false
            leave()
          })
        }}
      >
        <Icon icon={variant === 'close' ? CloseIcon : BackIcon} size={24} />
      </Link>
      {actions ? <div className="qt-pushed__actions">{actions}</div> : null}
    </header>
  )
}
