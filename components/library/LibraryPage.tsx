'use client'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/components/providers/AuthContext'
import { useUserHighlightsQuery } from '@/hooks/convex/useHighlightQueries'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import {
  articleHref,
  readBookmarks,
  BOOKMARK_EVENT,
  type Bookmark,
} from '@/lib/library/bookmarks'
import { buildRegisterHref } from '@/lib/auth/safeReturnPath'
export type LibraryHighlight = {
  _id: string
  text: string
  article: { title: string; slug: string; authorUsername: string } | null
}
export function LibraryView({
  bookmarks,
  highlights,
}: {
  bookmarks: Bookmark[]
  highlights: LibraryHighlight[] | undefined
}) {
  return (
    <main className="collection-page">
      <Link className="back" href="/articles">
        ← Articles
      </Link>
      <h1>Your library.</h1>
      <p>
        Bookmarks stay in this browser and do not sync across devices. Your
        saved highlights sync with your account.
      </p>
      <h2>Bookmarked articles</h2>
      {bookmarks.length ? (
        bookmarks.map((b) => (
          <Link className="library-row" key={b.id} href={articleHref(b)}>
            <span>
              <small>
                {b.topic} · {b.minutes} min read
              </small>
              <strong>{b.title}</strong>
              <span>{b.author}</span>
            </span>
            <span aria-hidden>↗</span>
          </Link>
        ))
      ) : (
        <div className="library-empty">
          <p>No bookmarks yet. Pick a story and tap its bookmark.</p>
          <Link className="library-browse" href="/articles">
            Browse articles ↗
          </Link>
        </div>
      )}
      <h2>Your highlights</h2>
      {highlights === undefined ? (
        <p role="status">Loading your highlights…</p>
      ) : highlights.filter((h) => h.article).length ? (
        highlights
          .filter((h) => h.article)
          .map((h) => (
            <Link
              key={h._id}
              className="library-row passage-row"
              href={`${articleHref({ username: h.article!.authorUsername, slug: h.article!.slug })}?highlight=${encodeURIComponent(h._id)}`}
            >
              <span>
                <blockquote>{h.text}</blockquote>
                <small>{h.article!.title}</small>
              </span>
              <span aria-hidden>↗</span>
            </Link>
          ))
      ) : (
        <div className="library-empty">
          <p>Select a passage in an article to keep it here.</p>
          <Link className="library-browse" href="/articles">
            Find something to read ↗
          </Link>
        </div>
      )}
    </main>
  )
}
export function LibraryShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="prototype-library" data-view="journal">
      <header>
        <LandingWordmark />
        <nav aria-label="Main navigation">
          <Link href="/articles">Articles</Link>
          <Link href="/library" aria-current="page">
            Your library
          </Link>
          <Link href="/write">Writing desk</Link>
        </nav>
      </header>
      {children}
    </div>
  )
}
function AccountLibrary({
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
export function LibraryPage() {
  const { user, isAuthenticated, isLoading } = useAuth()
  const router = useRouter()
  useEffect(() => {
    if (!isLoading && !isAuthenticated)
      router.replace(buildRegisterHref('/library'))
  }, [isLoading, isAuthenticated, router])
  return (
    <LibraryShell>
      {!isLoading && isAuthenticated && user ? (
        <AccountLibrary key={user._id} userId={user._id} />
      ) : (
        <main className="collection-page">
          <p role="status">
            {isLoading
              ? 'Opening your library…'
              : 'Sign in or create an account to open your library.'}
          </p>
          {!isLoading && (
            <Link
              className="library-browse"
              href={buildRegisterHref('/library')}
            >
              Create an account ↗
            </Link>
          )}
        </main>
      )}
    </LibraryShell>
  )
}
