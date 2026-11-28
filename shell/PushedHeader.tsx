'use client'

import { AppLink as Link } from '@/system/components/AppLink'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
  /** The screen's title, shown in the header after TITLE_AFTER_PX of
   * scroll (shell/headerOnScroll.ts), on one line. */
  title?: string
  /** Drawn along the header's bottom edge (the article's reading progress). */
  progress?: ReactNode
}

/**
 * The top of a pushed screen: a back (or Close) control and, at the end,
 * the screen's actions. Back returns through history when the entry behind
 * is a page of the application (shell/appHistory.ts), so the place
 * underneath gets its scroll position back; otherwise (opened from outside,
 * or after the browser's Back took the visit to the first page) it goes to
 * `fallbackHref`, and never leaves the site. It works with no script (a
 * plain link; `onBack` then cannot run).
 *
 * It stays at the top as the reader scrolls (shell/headerOnScroll.ts,
 * loaded after the page's first load; the header shows until then):
 * gone on a scroll down, back on the reader's own scroll up, at the top and
 * at the end, and whenever focus is in it. It sits over the page, so
 * showing and hiding never moves the text. `--qt-pushed-header-h` on
 * <html> is its visible height (0 while hidden), and the page's
 * `scroll-padding-top` adds it, so anchors land clear of it.
 */
export function PushedHeader({
  fallbackHref,
  backLabel,
  variant = 'back',
  onBack,
  actions,
  title,
  progress,
}: PushedHeaderProps) {
  const router = useRouter()
  const leaving = useRef(false)
  const header = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(true)
  const [titled, setTitled] = useState(false)
  useEffect(() => {
    const node = header.current
    if (!node) return
    const root = document.documentElement
    root.style.setProperty(
      '--qt-pushed-header-h',
      `${Math.round(node.offsetHeight)}px`
    )
    let stop: (() => void) | undefined
    let gone = false
    void import('./headerOnScroll').then(({ watchHeader }) => {
      if (!gone)
        stop = watchHeader(node, { shown: setShown, titled: setTitled })
    })
    return () => {
      gone = true
      stop?.()
      root.style.removeProperty('--qt-pushed-header-h')
    }
  }, [])
  const leave = () => {
    if (appHistory.canGoBack()) router.back()
    else router.push(fallbackHref)
  }
  return (
    <header
      ref={header}
      className="qt-pushed__header"
      data-hidden={shown ? undefined : ''}
    >
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
      {title ? (
        <p className="qt-pushed__title" data-shown={titled || undefined}>
          {title}
        </p>
      ) : null}
      {actions ? <div className="qt-pushed__actions">{actions}</div> : null}
      {progress ? <div className="qt-pushed__progress">{progress}</div> : null}
    </header>
  )
}
