'use client'

import { useEffect, useMemo, useState } from 'react'
import type { TocHeading } from '@/lib/tiptap/headings'

const ARTICLE_ROOT_SELECTOR = '.article-content'
/** Below fixed nav (h-16) + thin progress strip; aligns with prose scroll-margin. */
const ACTIVE_HEADING_TOP_OFFSET_PX = 96

interface ArticleTableOfContentsProps {
  headings: TocHeading[]
}

function getHeadingElements(ids: string[]): HTMLElement[] {
  return ids
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el instanceof HTMLElement)
}

function pickActiveId(ids: string[]): string | null {
  let active: string | null = null
  let firstFound: string | null = null

  for (const id of ids) {
    const el = document.getElementById(id)
    if (!el) continue
    if (firstFound == null) firstFound = id
    if (el.getBoundingClientRect().top <= ACTIVE_HEADING_TOP_OFFSET_PX) {
      active = id
    }
  }

  return active ?? firstFound
}

export function ArticleTableOfContents({
  headings,
}: ArticleTableOfContentsProps) {
  const enabled = headings.length >= 3
  const [activeId, setActiveId] = useState<string | null>(null)

  const ids = useMemo(() => headings.map((h) => h.id), [headings])

  useEffect(() => {
    if (!enabled) return

    const root = document.querySelector(ARTICLE_ROOT_SELECTOR) ?? document.body

    let scrollCleanup: (() => void) | null = null
    let mo: MutationObserver | null = null

    const updateActive = () => {
      setActiveId(pickActiveId(ids))
    }

    const attachScrollListeners = () => {
      updateActive()
      window.addEventListener('scroll', updateActive, { passive: true })
      window.addEventListener('resize', updateActive)
      return () => {
        window.removeEventListener('scroll', updateActive)
        window.removeEventListener('resize', updateActive)
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
    }
  }, [enabled, ids])

  if (!enabled) return null

  return (
    <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-[var(--card-padding)]">
      <h3 className="text-lg font-semibold mb-3">On this page</h3>
      <nav aria-label="Table of contents">
        <ul className="space-y-1">
          {headings.map((h) => {
            const isActive = activeId === h.id
            return (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => {
                    document.getElementById(h.id)?.scrollIntoView({
                      behavior: 'smooth',
                      block: 'start',
                    })
                  }}
                  className={[
                    'w-full text-left text-sm rounded px-2 py-1.5 transition-colors',
                    isActive
                      ? 'bg-primary/10 text-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  ].join(' ')}
                >
                  {h.text}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}
