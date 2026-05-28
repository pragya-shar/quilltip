import type { MouseEvent } from 'react'
import { revealSection } from '@/components/landing/Reveal'

const SCROLL_END_FALLBACK_MS = 800

function waitForScrollEnd(): Promise<void> {
  return new Promise((resolve) => {
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      window.removeEventListener('scrollend', onScrollEnd)
      clearTimeout(fallback)
      resolve()
    }

    const onScrollEnd = () => finish()
    const fallback = setTimeout(finish, SCROLL_END_FALLBACK_MS)

    if ('onscrollend' in window) {
      window.addEventListener('scrollend', onScrollEnd, { once: true })
    } else {
      finish()
    }
  })
}

export function scrollToLandingSection(hash: string): void {
  const normalized = hash.startsWith('#') ? hash : `#${hash}`
  const element = document.querySelector(normalized)
  if (!element || !(element instanceof HTMLElement)) return

  element.scrollIntoView({ behavior: 'smooth', block: 'start' })

  void waitForScrollEnd().then(() => {
    revealSection(normalized)
  })
}

export function handleLandingHashClick(
  e: MouseEvent<HTMLAnchorElement>,
  href: string
): boolean {
  if (!href.startsWith('#')) return false

  e.preventDefault()
  scrollToLandingSection(href)
  return true
}
