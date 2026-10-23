'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/components/providers/AuthContext'
import { useUserHighlightsQuery } from '@/hooks/convex/useHighlightQueries'
import {
  readBookmarks,
  BOOKMARK_EVENT,
  type Bookmark,
} from '@/lib/library/bookmarks'
import { LibraryView } from './LibraryView'

export function AccountLibrary({
  userId,
}: {
  userId: NonNullable<ReturnType<typeof useAuth>['user']>['_id']
}) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() =>
    readBookmarks(userId)
  )
  const highlights = useUserHighlightsQuery(userId)
  useEffect(() => {
    const refresh = () => setBookmarks(readBookmarks(userId))
    refresh()
    window.addEventListener(BOOKMARK_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(BOOKMARK_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [userId])
  return <LibraryView bookmarks={bookmarks} highlights={highlights} />
}
