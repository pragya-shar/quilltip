'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { cx } from '@/system/cx'

/**
 * A bar docked at the foot of a pushed screen (the tip bar). While it is on
 * screen it reports to the shell how far its top edge is from the bottom of
 * the viewport (`--qt-dock-h` and `data-docked` on <html>), updated on
 * resize and scroll, so toasts sit above it and never cover a control the
 * reader needs next.
 */
export function Dock({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const node = ref.current
    if (!node) return
    const root = document.documentElement
    let frame = 0
    const report = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const viewport = window.visualViewport?.height ?? window.innerHeight
        const top = node.getBoundingClientRect().top
        const lift = Math.max(0, Math.min(viewport, viewport - top))
        root.style.setProperty('--qt-dock-h', `${Math.round(lift)}px`)
      })
    }
    report()
    root.setAttribute('data-docked', '')
    const observer = new ResizeObserver(report)
    observer.observe(node)
    window.addEventListener('scroll', report, { passive: true })
    window.addEventListener('resize', report)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', report)
      window.removeEventListener('resize', report)
      observer.disconnect()
      root.removeAttribute('data-docked')
      root.style.removeProperty('--qt-dock-h')
    }
  }, [])
  return (
    <div ref={ref} className={cx('qt-dock', className)}>
      {children}
    </div>
  )
}
