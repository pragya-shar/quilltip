'use client'

import { AppLink as Link } from '@/system/components/AppLink'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from '@/system/components/Icon'
import { BackIcon, CloseIcon } from '@/system/icons'
import { appHistory } from './appHistory'
import { createHeaderOnScroll } from './headerOnScroll'

/** Past this scroll the header carries the screen's title. */
export const TITLE_AFTER_PX = 140

const SCROLL_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' ',
])

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
   * scroll, on one line. */
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
 * It stays at the top as the reader scrolls (shell/headerOnScroll.ts):
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
    const model = createHeaderOnScroll()
    const root = document.documentElement
    let pointerDown = false
    const publish = (on: boolean) => {
      setShown(on)
      root.style.setProperty(
        '--qt-pushed-header-h',
        on ? `${Math.round(node.offsetHeight)}px` : '0px'
      )
    }
    const onScroll = () => {
      const y = window.scrollY
      setTitled(y > TITLE_AFTER_PX)
      publish(
        model.scroll({
          y,
          max: root.scrollHeight - window.innerHeight,
          height: node.offsetHeight,
          at: performance.now(),
        })
      )
    }
    const intent = () => model.intent(performance.now())
    const onKey = (event: KeyboardEvent) => {
      if (SCROLL_KEYS.has(event.key)) intent()
    }
    const onSelection = () => {
      const selection = document.getSelection()
      model.selecting(
        pointerDown && Boolean(selection && !selection.isCollapsed)
      )
    }
    const onPointerDown = () => {
      pointerDown = true
    }
    const onPointerUp = () => {
      pointerDown = false
      model.selecting(false)
    }
    const onFocusIn = () => {
      model.focus(true)
      publish(true)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (node.contains(event.relatedTarget as Node | null)) return
      model.focus(false)
      onScroll()
    }
    publish(true)
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', intent, { passive: true })
    window.addEventListener('touchmove', intent, { passive: true })
    window.addEventListener('keydown', onKey)
    document.addEventListener('selectionchange', onSelection)
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('pointercancel', onPointerUp, true)
    node.addEventListener('focusin', onFocusIn)
    node.addEventListener('focusout', onFocusOut)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', intent)
      window.removeEventListener('touchmove', intent)
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('selectionchange', onSelection)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('pointerup', onPointerUp, true)
      window.removeEventListener('pointercancel', onPointerUp, true)
      node.removeEventListener('focusin', onFocusIn)
      node.removeEventListener('focusout', onFocusOut)
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
