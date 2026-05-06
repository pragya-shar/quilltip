'use client'

import { useEffect } from 'react'
import type { TocHeading } from '@/lib/tiptap/headings'

interface EnsureHeadingIdsOptions {
  /** CSS selector for the root element that contains the rendered article. */
  rootSelector?: string
}

/**
 * Keeps rendered <h2> ids in sync with ToC heading ids. TipTap mounts headings
 * after the first paint and can replace the whole editor (e.g. highlightable
 * mode), so we watch the subtree and re-apply whenever the DOM changes.
 */
export function useEnsureHeadingIds(
  headings: TocHeading[],
  { rootSelector }: EnsureHeadingIdsOptions = {}
) {
  useEffect(() => {
    if (headings.length === 0) return

    const root =
      (rootSelector ? document.querySelector(rootSelector) : null) ??
      document.body

    const apply = () => {
      const h2s = Array.from(root.querySelectorAll('h2'))
      let i = 0
      for (const el of h2s) {
        const next = headings[i]
        if (!next) break
        if (el.id !== next.id) el.id = next.id
        i += 1
      }
    }

    apply()

    let raf: number | null = null
    const schedule = () => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        apply()
      })
    }

    const mo = new MutationObserver(schedule)
    mo.observe(root, { childList: true, subtree: true })
    return () => {
      mo.disconnect()
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [headings, rootSelector])
}
