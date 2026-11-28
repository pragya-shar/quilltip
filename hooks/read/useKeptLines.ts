'use client'

import { useMemo } from 'react'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import type { Id } from '@/convex/_generated/dataModel'

export type KeptLine = {
  id: Id<'highlights'>
  startOffset: number
  endOffset: number
}

/**
 * The lines this reader kept in this article, from the server, so they are
 * marked again on every open (and Keep never duplicates one). Signed out,
 * there are none. Live: a Keep or a removal shows up here once it is saved.
 */
export function useKeptLines(
  articleId: Id<'articles'>,
  signedIn: boolean
): KeptLine[] | undefined {
  const me = useQuery(api.users.getCurrentUser, signedIn ? {} : 'skip')
  const rows = useQuery(
    api.highlights.getArticleHighlights,
    signedIn ? { articleId } : 'skip'
  )
  return useMemo(() => {
    if (!signedIn) return []
    if (!me || !rows) return undefined
    return rows
      .filter((row) => row.userId === me._id && !row.removedAt)
      .map((row) => ({
        id: row._id,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
      }))
  }, [me, rows, signedIn])
}
