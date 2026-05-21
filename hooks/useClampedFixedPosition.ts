'use client'

import { useLayoutEffect, useState, type RefObject } from 'react'
import {
  clampFixedPanelPosition,
  type PanelAnchor,
} from '@/lib/ui/clampFixedPanelPosition'

const DEFAULT_FALLBACK_WIDTH = 320
const DEFAULT_FALLBACK_HEIGHT = 260

export function useClampedFixedPosition(
  anchor: PanelAnchor,
  panelRef: RefObject<HTMLElement | null>,
  options?: {
    margin?: number
    fallbackWidth?: number
    fallbackHeight?: number
  }
): { top: number; left: number } {
  const margin = options?.margin ?? 12
  const fallbackWidth = options?.fallbackWidth ?? DEFAULT_FALLBACK_WIDTH
  const fallbackHeight = options?.fallbackHeight ?? DEFAULT_FALLBACK_HEIGHT
  const anchorTop = anchor.top
  const anchorLeft = anchor.left

  const [position, setPosition] = useState(() =>
    clampFixedPanelPosition(
      { top: anchorTop, left: anchorLeft },
      { width: fallbackWidth, height: fallbackHeight },
      {
        width: typeof window !== 'undefined' ? window.innerWidth : 0,
        height: typeof window !== 'undefined' ? window.innerHeight : 0,
      },
      margin
    )
  )

  useLayoutEffect(() => {
    const recalc = () => {
      const rect = panelRef.current?.getBoundingClientRect()
      const width = rect?.width ?? fallbackWidth
      const height = rect?.height ?? fallbackHeight

      setPosition(
        clampFixedPanelPosition(
          { top: anchorTop, left: anchorLeft },
          { width, height },
          { width: window.innerWidth, height: window.innerHeight },
          margin
        )
      )
    }

    recalc()

    window.addEventListener('resize', recalc)

    const element = panelRef.current
    let resizeObserver: ResizeObserver | undefined
    if (element && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(recalc)
      resizeObserver.observe(element)
    }

    return () => {
      window.removeEventListener('resize', recalc)
      resizeObserver?.disconnect()
    }
  }, [anchorTop, anchorLeft, panelRef, margin, fallbackWidth, fallbackHeight])

  return position
}
