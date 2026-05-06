'use client'

import { useEffect, useRef, useState } from 'react'

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n < 0) return 0
  if (n > 1) return 1
  return n
}

function getViewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function getWindowScrollY(): number {
  return window.scrollY ?? window.pageYOffset ?? 0
}

function getWindowScrollRange(): number {
  const doc = document.documentElement
  const body = document.body
  if (!body) return 0
  const height = Math.max(
    body.scrollHeight,
    body.offsetHeight,
    doc.scrollHeight,
    doc.offsetHeight
  )
  return Math.max(0, height - getViewportHeight())
}

function findLikelyNestedScrollRoot(): HTMLElement | null {
  const vh = getViewportHeight()
  let best: HTMLElement | null = null
  let bestCh = 0

  for (const node of document.querySelectorAll('*')) {
    if (!(node instanceof HTMLElement)) continue
    if (node === document.body || node === document.documentElement) continue

    const { overflowY } = getComputedStyle(node)
    if (
      overflowY !== 'auto' &&
      overflowY !== 'scroll' &&
      overflowY !== 'overlay'
    )
      continue
    if (node.scrollHeight <= node.clientHeight + 1) continue
    if (node.clientHeight < vh * 0.55) continue

    if (node.clientHeight > bestCh) {
      bestCh = node.clientHeight
      best = node
    }
  }

  return best
}

function getScrollProgress(nested: HTMLElement | null): number {
  const sy = getWindowScrollY()
  const maxW = getWindowScrollRange()

  let maxN = 0
  let sn = 0
  if (nested) {
    maxN = Math.max(0, nested.scrollHeight - nested.clientHeight)
    sn = nested.scrollTop
  }

  if (maxW > 1 && sy > 0) {
    return clamp01(sy / maxW)
  }

  if (nested && maxN > 1 && sn > 0 && sy === 0) {
    return clamp01(sn / maxN)
  }

  if (maxW > 1) {
    return clamp01(sy / maxW)
  }

  if (nested && maxN > 1) {
    return clamp01(sn / maxN)
  }

  return 0
}

export function ReadingProgressBar() {
  const [progress, setProgress] = useState(0)
  const nestedRef = useRef<HTMLElement | null>(null)
  const frameRef = useRef(0)

  useEffect(() => {
    const refreshNested = () => {
      nestedRef.current = findLikelyNestedScrollRoot()
    }

    refreshNested()

    const ro =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            refreshNested()
          })
        : null
    ro?.observe(document.documentElement)
    if (document.body) ro?.observe(document.body)

    const onLayout = () => refreshNested()
    window.addEventListener('load', onLayout)
    window.addEventListener('resize', onLayout)
    visualViewport?.addEventListener('resize', onLayout)

    let frameCount = 0
    const tick = () => {
      frameCount += 1
      if (frameCount % 45 === 0) refreshNested()

      const next = getScrollProgress(nestedRef.current)
      setProgress((prev) => (Object.is(prev, next) ? prev : next))

      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frameRef.current)
      window.removeEventListener('load', onLayout)
      window.removeEventListener('resize', onLayout)
      visualViewport?.removeEventListener('resize', onLayout)
      ro?.disconnect()
    }
  }, [])

  return (
    <div
      className="pointer-events-none fixed left-0 right-0 top-16 z-[100] h-1 w-full bg-border/40"
      aria-hidden
    >
      <div className="relative h-full w-full">
        <div
          className="absolute left-0 top-0 h-full min-w-0 bg-primary"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  )
}
