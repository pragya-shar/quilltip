'use client'

import { useEffect, useRef } from 'react'
import { READ_BODY_ID } from './readModel'

/**
 * A thin line at the top of the screen that fills as the body is read. It
 * is decoration: the scroll bar and the text already say where the reader
 * is, so screen readers skip it. Transform only; no layout.
 */
export function ReadingProgress() {
  const bar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const body = document.getElementById(READ_BODY_ID)
    if (!body || !bar.current) return
    let frame = 0
    const draw = () => {
      frame = 0
      const rect = body.getBoundingClientRect()
      const read = (window.innerHeight - rect.top) / Math.max(1, rect.height)
      const share = Math.max(0, Math.min(1, read))
      bar.current?.style.setProperty('--qt-read-progress', String(share))
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw)
    }
    draw()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    }
  }, [])
  return <div ref={bar} className="qt-read__progress" aria-hidden="true" />
}
