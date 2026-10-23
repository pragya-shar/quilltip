'use client'

import { useEffect, useRef } from 'react'

/** Move the sample into its reading plane without changing its playback state. */
export function usePaperArrival(ready = true) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const hero = ref.current
    const paper = hero?.querySelector<HTMLElement>('.product-area')
    if (!ready || !hero || !paper) return

    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let frame: number | null = null
    const draw = () => {
      frame = null
      const progress = media.matches
        ? 1
        : Math.max(
            0,
            Math.min(
              1,
              (window.innerHeight - paper.getBoundingClientRect().top) /
                (window.innerHeight * 0.85)
            )
          )
      hero.style.setProperty('--paper-arrival', String(progress))
    }
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(draw)
    }

    const observer = new ResizeObserver(schedule)
    observer.observe(hero)
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    media.addEventListener('change', schedule)
    schedule()

    return () => {
      if (frame !== null) cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      media.removeEventListener('change', schedule)
      hero.style.removeProperty('--paper-arrival')
    }
  }, [ready])

  return ref
}
