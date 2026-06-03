'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { pickActiveId } from '@/lib/articles/tocActiveSection'
import type { TocHeading } from '@/lib/tiptap/headings'

const ARTICLE_ROOT_SELECTOR = '.article-content'
const TOC_HEADING_ID = 'article-toc-heading'

const TOC_LINK_CLASS =
  'block w-full text-left text-sm rounded px-2 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

interface ArticleTableOfContentsProps {
  headings: TocHeading[]
}

function getHeadingElements(ids: string[]): HTMLElement[] {
  return ids
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
}

export function ArticleTableOfContents({
  headings,
}: ArticleTableOfContentsProps) {
  const enabled = headings.length >= 3
  const [activeId, setActiveId] = useState<string | null>(null)

  const ids = useMemo(() => headings.map((h) => h.id), [headings])

  const syncActiveFromScroll = useCallback(() => {
    setActiveId((prev) => {
      const next = pickActiveId(ids)
      return prev === next ? prev : next
    })
  }, [ids])

  useEffect(() => {
    if (!enabled) return

    const root = document.querySelector(ARTICLE_ROOT_SELECTOR) ?? document.body

    let scrollCleanup: (() => void) | null = null
    let mo: MutationObserver | null = null
    let raf: number | null = null

    const scheduleSyncActive = () => {
      if (raf != null) return
      raf = requestAnimationFrame(() => {
        raf = null
        syncActiveFromScroll()
      })
    }

    const attachScrollListeners = () => {
      syncActiveFromScroll()
      window.addEventListener('scroll', scheduleSyncActive, { passive: true })
      window.addEventListener('resize', scheduleSyncActive)
      return () => {
        window.removeEventListener('scroll', scheduleSyncActive)
        window.removeEventListener('resize', scheduleSyncActive)
        if (raf != null) {
          cancelAnimationFrame(raf)
          raf = null
        }
      }
    }

    const tryAttach = (): boolean => {
      if (getHeadingElements(ids).length === 0) return false
      scrollCleanup?.()
      scrollCleanup = attachScrollListeners()
      return true
    }

    if (!tryAttach()) {
      mo = new MutationObserver(() => {
        if (tryAttach()) {
          mo?.disconnect()
          mo = null
        }
      })
      mo.observe(root, { childList: true, subtree: true })
    }

    return () => {
      mo?.disconnect()
      scrollCleanup?.()
      if (raf != null) cancelAnimationFrame(raf)
    }
  }, [enabled, ids, syncActiveFromScroll])

  const scrollToHeading = useCallback((id: string) => {
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    })
  }, [])

  if (!enabled) return null

  return (
    <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-[var(--card-padding)]">
      <h3 id={TOC_HEADING_ID} className="text-lg font-semibold mb-3">
        On this page
      </h3>
      <nav aria-labelledby={TOC_HEADING_ID}>
        <ul className="space-y-1">
          {headings.map((h) => {
            const isActive = activeId === h.id
            return (
              <li key={h.id}>
                <a
                  href={`#${h.id}`}
                  aria-current={isActive ? 'location' : undefined}
                  onClick={(e) => {
                    e.preventDefault()
                    scrollToHeading(h.id)
                  }}
                  className={[
                    TOC_LINK_CLASS,
                    isActive
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                >
                  {h.text}
                </a>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
