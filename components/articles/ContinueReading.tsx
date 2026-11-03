'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import {
  readReadingProgress,
  type ReadingPosition,
} from '@/lib/articles/readingProgress'

export function ContinueReading() {
  const [entries, setEntries] = useState<ReadingPosition[]>([])
  useEffect(() => {
    const refresh = () => setEntries(readReadingProgress())
    refresh()
    window.addEventListener('pageshow', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('pageshow', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const article = useQuery(
    api.articles.getContinueReadingArticle,
    entries.length ? { ids: entries.map(({ id }) => id) } : 'skip'
  )
  const progress = article && entries.find(({ id }) => id === article.id)
  if (!article || !progress) return null

  return (
    <aside className="continue-reading">
      <p>Continue reading · {Math.round(progress.ratio * 100)}%</p>
      <Link
        href={`/${encodeURIComponent(article.username)}/${encodeURIComponent(article.slug)}?resume=1`}
      >
        <span>{article.title}</span> <span aria-hidden="true">→</span>
      </Link>
    </aside>
  )
}
