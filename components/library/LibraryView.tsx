import Link from 'next/link'
import { articleHref, type Bookmark } from '@/lib/library/bookmarks'

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
