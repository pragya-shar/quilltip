'use client'

import { useEffect } from 'react'
import { scrollToLandingSection } from '@/lib/landing/scroll-to-section'

const SECTION_WAIT_TIMEOUT_MS = 3000

function scrollWhenAvailable(
  hash: string,
  timeoutMs = SECTION_WAIT_TIMEOUT_MS
) {
  const normalized = hash.startsWith('#') ? hash : `#${hash}`

  if (document.querySelector(normalized)) {
    scrollToLandingSection(normalized)
    return () => {}
  }

  let settled = false
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const observer = new MutationObserver(() => {
    if (settled) return
    if (document.querySelector(normalized)) {
      settled = true
      observer.disconnect()
      if (timeoutId !== null) clearTimeout(timeoutId)
      scrollToLandingSection(normalized)
    }
  })

  observer.observe(document.body, { childList: true, subtree: true })

  timeoutId = setTimeout(() => {
    if (settled) return
    settled = true
    observer.disconnect()
  }, timeoutMs)

  return () => {
    if (settled) return
    settled = true
    observer.disconnect()
    if (timeoutId !== null) clearTimeout(timeoutId)
  }
}

export function useLandingHashScroll() {
  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return

    return scrollWhenAvailable(hash)
  }, [])

  useEffect(() => {
    let cancel: (() => void) | null = null

    const onHashChange = () => {
      const hash = window.location.hash
      if (!hash) return
      cancel?.()
      cancel = scrollWhenAvailable(hash)
    }

    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
      cancel?.()
    }
  }, [])
}
