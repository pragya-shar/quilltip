'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useAuth } from '@/components/providers/AuthContext'
import { buildRegisterHref } from '@/lib/auth/safeReturnPath'
import {
  articleHref,
  readBookmarks,
  toggleBookmark,
  BOOKMARK_EVENT,
  type Bookmark,
} from '@/lib/library/bookmarks'
export function BookmarkButton({ article }: { article: Bookmark }) {
  const { user, isLoading } = useAuth()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const refresh = () =>
      setSaved(
        user ? readBookmarks(user._id).some((b) => b.id === article.id) : false
      )
    // Complete the guest's explicit bookmark intent after the real signup return.
    if (user) {
      const url = new URL(location.href)
      if (url.searchParams.get('bookmark') === '1') {
        try {
          if (!readBookmarks(user._id).some((b) => b.id === article.id))
            toggleBookmark(user._id, article)
          url.searchParams.delete('bookmark')
          history.replaceState(
            history.state,
            '',
            url.pathname + url.search + url.hash
          )
        } catch {
          setError(
            'Browser storage is unavailable. This bookmark was not saved.'
          )
        }
      }
    }
    refresh()
    window.addEventListener(BOOKMARK_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(BOOKMARK_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [user, article])
  const icon = (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill={saved ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden
    >
      <path d="M6 3h12v18l-6-4-6 4z" />
    </svg>
  )
  if (!user && !isLoading)
    return (
      <Link
        className="article-bookmark"
        href={buildRegisterHref(articleHref(article) + '?bookmark=1')}
        aria-label={`Bookmark ${article.title}`}
      >
        {icon}
      </Link>
    )
  return (
    <>
      <button
        className="article-bookmark"
        disabled={isLoading}
        aria-label={`${saved ? 'Remove bookmark for' : 'Bookmark'} ${article.title}`}
        aria-pressed={saved}
        onClick={() => {
          if (!user) return
          try {
            toggleBookmark(user._id, article)
            setError('')
          } catch {
            setError(
              'Browser storage is unavailable. This bookmark was not saved.'
            )
          }
        }}
      >
        {icon}
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  )
}
