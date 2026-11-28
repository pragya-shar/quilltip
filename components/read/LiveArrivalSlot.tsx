'use client'

import { useEffect, useState, type ComponentType } from 'react'
import { readAnchor } from '@/lib/tiptap/readAnchors'
import { loadLiveArrival, type LiveArrivalProps } from './liveArrivalLoader'
import { READ_TITLE_ID, type ReadArticle } from './readModel'

/**
 * The slot above the tip bar where the Write package's arrival runs, once:
 * only when `armed` (see `liveArrival.ts`), only for the article's author,
 * and only when Write has shipped its loader. It unmounts on `done`, on
 * Escape, and when the reader leaves the page.
 */
export function LiveArrivalSlot({
  article,
  armed,
  own,
  onDone,
}: {
  article: ReadArticle
  armed: boolean
  own: boolean
  onDone: () => void
}) {
  const run = armed && own && loadLiveArrival !== null
  const [Arrival, setArrival] =
    useState<ComponentType<LiveArrivalProps> | null>(null)

  useEffect(() => {
    if (!run || !loadLiveArrival) return
    let live = true
    loadLiveArrival().then(
      (module) => {
        if (live) setArrival(() => module.default)
      },
      // No arrival is no loss: the article is already there.
      () => onDone()
    )
    return () => {
      live = false
    }
  }, [run, onDone])

  useEffect(() => {
    if (!run) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, onDone])

  const title = run ? document.getElementById(READ_TITLE_ID) : null
  if (!run || !Arrival || !title) return null
  return (
    <div className="qt-read__arrival">
      <Arrival
        articleId={article.id}
        title={title}
        href={article.href}
        lineHref={(p, k) => `${article.href}#${readAnchor(p, k)}`}
        done={onDone}
      />
    </div>
  )
}
