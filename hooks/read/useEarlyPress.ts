'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { sheetStack } from '@/shell/sheetStack'

/**
 * How long a tip pressed before the money layer's controller is ready may
 * wait for it. Past this the press is dropped and the bar says so: a tip is
 * never sent seconds after the reader has moved on.
 */
export const EARLY_PRESS_LIMIT_MS = 3000

/** A tip press made before the controller was ready, as it was then. */
export type EarlyPress<Line> = { at: number; line: Line }

/**
 * A tip press the tip bar takes before the money layer's controller is
 * ready (its code loads after the page). The press is recorded at once and
 * shown as taken; the bar hands it to the controller once, through its own
 * press path, when the controller is ready (`take`). It is dropped:
 * - after `EARLY_PRESS_LIMIT_MS`, and then `missed` is true until the next
 *   press, so the bar can say nothing was sent;
 * - on a path change, when the page is hidden, and when a sheet opens.
 * A second press while one is recorded does nothing.
 */
export function useEarlyPress<Line>() {
  const recorded = useRef<EarlyPress<Line> | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [pending, setPending] = useState(false)
  const [missed, setMissed] = useState(false)

  const drop = useCallback((miss = false) => {
    clearTimeout(timer.current)
    if (!recorded.current) return
    recorded.current = null
    setPending(false)
    if (miss) setMissed(true)
  }, [])

  /** Records a press; false when one is already recorded. */
  const record = useCallback(
    (line: Line) => {
      if (recorded.current) return false
      recorded.current = { at: Date.now(), line }
      setPending(true)
      setMissed(false)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => drop(true), EARLY_PRESS_LIMIT_MS)
      return true
    },
    [drop]
  )

  /** The recorded press, once, if it is still in time; else null. */
  const take = useCallback((): EarlyPress<Line> | null => {
    const press = recorded.current
    if (!press) return null
    const late = Date.now() - press.at > EARLY_PRESS_LIMIT_MS
    drop(late)
    return late ? null : press
  }, [drop])

  const clearMissed = useCallback(() => setMissed(false), [])

  // A path change: the press was for the page the reader left.
  const pathname = usePathname()
  const firstPath = useRef(pathname)
  useEffect(() => {
    if (pathname !== firstPath.current) drop()
  }, [pathname, drop])

  // The page is hidden (another tab, another app, leaving), or a sheet
  // opens over the bar: the reader moved on.
  useEffect(() => {
    const onHide = () => drop()
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') drop()
    }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVisibility)
    let open = sheetStack.get().filter((entry) => entry.open).length
    const stop = sheetStack.subscribe(() => {
      const now = sheetStack.get().filter((entry) => entry.open).length
      if (now > open) drop()
      open = now
    })
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
      clearTimeout(timer.current)
    }
  }, [drop])

  return { pending, missed, record, take, drop, clearMissed }
}
