'use client'

import { useEffect } from 'react'
import { scrollToLandingSection } from '@/lib/landing/scroll-to-section'

export function useLandingHashScroll() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return

    const frame = requestAnimationFrame(() => {
      scrollToLandingSection(hash)
    })

    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash
      if (hash) scrollToLandingSection(hash)
    }

    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
}
