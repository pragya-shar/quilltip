'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  useBrowseAuthors,
  useBrowseTags,
  useListArticles,
} from '@/hooks/convex'
import { LandingWordmark } from '@/components/landing/LandingWordmark'
import { LandingOrnaments } from '@/components/landing/LandingOrnaments'
import { ReadingRoomCard } from './ReadingRoomCard'
import { buildArticlesBrowseHref } from '@/lib/articles/buildArticlesBrowseHref'
import {
  parseBrowseSort,
  parseBrowseView,
} from '@/lib/articles/browseDiscovery'
import { parseArticlesPageParam } from '@/lib/articles/parseArticlesPageParam'
import {
  buildArticlesBrowseScrollStorageKey,
  readBrowseScrollY,
  writeBrowseScrollY,
} from '@/lib/articles/browseListScrollStorage'
import { mapListArticlesToDisplay } from '@/lib/articles/mapListArticleToDisplay'
import { getBrowseContextMessage } from './ArticlesBrowseDiscoveryHeader'

export function ReadingRoomShell({ children }: { children: ReactNode }) {
  return (
    <div className="reading-room">
      <LandingOrnaments rootSelector=".reading-room" count={15} />
      <header className="reading-room-header">
        <LandingWordmark />
        <nav aria-label="Main navigation">
          <Link href="/articles" aria-current="page">
            Articles
          </Link>
          <Link href="/library">Your library</Link>
          <Link href="/write">Writing desk</Link>
        </nav>
      </header>
      {children}
    </div>
  )
}

export function ReadingRoom() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const searchString = params?.toString() || ''
  const currentPage = parseArticlesPageParam(params?.get('page'))
  const requestedCount = Number(params?.get('count'))
  const visibleCount = Number.isFinite(requestedCount)
    ? Math.min(9, Math.max(3, requestedCount))
    : 3
  const tag = params?.get('tag') || undefined
  const author = params?.get('author') || undefined
  const search = params?.get('search') || undefined
  const view = parseBrowseView(params?.get('view'))
  const sort = parseBrowseSort(params?.get('sort'))
  const [searchText, setSearchText] = useState(search || '')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const didNavigate = useRef(false)
  const scrollKey = buildArticlesBrowseScrollStorageKey(pathname, searchString)
  const result = useListArticles({
    page: currentPage,
    limit: 9,
    tag,
    author,
    search,
    view,
    sort,
  })
  const topics = useBrowseTags()
  const authors = useBrowseAuthors()
  const cancelSearch = useCallback(() => {
    if (searchTimer.current !== null) clearTimeout(searchTimer.current)
    searchTimer.current = null
  }, [])
  useEffect(() => {
    cancelSearch()
    setSearchText(search || '')
    didNavigate.current = false
    return cancelSearch
  }, [searchString, search, cancelSearch])
  useEffect(() => {
    const previous = history.scrollRestoration
    history.scrollRestoration = 'manual'
    return () => {
      history.scrollRestoration = previous
    }
  }, [])
  useEffect(() => {
    const save = () => {
      if (!didNavigate.current) writeBrowseScrollY(scrollKey, window.scrollY)
    }
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [scrollKey])
  const ready = result !== undefined
  useLayoutEffect(() => {
    if (!ready) return
    const y = readBrowseScrollY(scrollKey)
    if (y !== null) window.scrollTo(0, y)
  }, [scrollKey, ready])
  const navigate = (
    changes: Omit<Parameters<typeof buildArticlesBrowseHref>[0], 'sourceParams'>
  ) => {
    cancelSearch()
    setSearchText(search || '')
    router.push(
      buildArticlesBrowseHref({ page: 1, ...changes, sourceParams: params })
    )
  }
  const savePosition = () => {
    cancelSearch()
    didNavigate.current = true
    writeBrowseScrollY(scrollKey, window.scrollY)
  }
  const articles = result ? mapListArticlesToDisplay(result.articles) : []
  const totalPages = result
    ? result.totalPages || Math.ceil(result.total / result.limit)
    : 0
  const message = result
    ? getBrowseContextMessage(view, result.browseMeta)
    : null
  const allTopics = topics?.map((t) => t.tag) || []
  if (tag && !allTopics.includes(tag)) allTopics.push(tag)
  return (
    <main className="reading-room-main">
      <section className="intro" aria-labelledby="reading-room-title">
        <span className="eyebrow">THE READING ROOM</span>
        <h1 id="reading-room-title">Story time.</h1>
        <p>Stories, thoughts, and everyday anecdotes.</p>
      </section>
      <div className="toolbar">
        <div className="filters" aria-label="Article topics">
          <button aria-pressed={!tag} onClick={() => navigate({ tag: '' })}>
            All
          </button>
          {allTopics.map((topic) => (
            <button
              key={topic}
              aria-pressed={tag === topic}
              onClick={() => navigate({ tag: topic })}
            >
              {topic}
            </button>
          ))}
          <Link href="/library">Bookmarked</Link>
        </div>
        <div className="search">
          <label htmlFor="reading-room-search">Search articles</label>
          {searchText && (
            <button
              className="clear-search"
              aria-label="Clear search"
              onClick={() => navigate({ search: '' })}
            >
              Clear
            </button>
          )}
          <input
            id="reading-room-search"
            type="search"
            value={searchText}
            placeholder="Title or excerpt…"
            onChange={(event) => {
              const value = event.target.value
              setSearchText(value)
              cancelSearch()
              searchTimer.current = setTimeout(() => {
                searchTimer.current = null
                router.push(
                  buildArticlesBrowseHref({
                    search: value,
                    page: 1,
                    sourceParams: params,
                  })
                )
              }, 300)
            }}
          />
        </div>
        <span className="article-count" aria-live="polite">
          {result
            ? `${result.total} ${result.total === 1 ? 'article' : 'articles'}`
            : ''}
        </span>
        <label className="sort-control">
          Sort by
          <select
            aria-label="Sort articles by"
            value={view === 'latest' ? sort : view}
            onChange={(event) => {
              const value = event.target.value
              if (value === 'featured' || value === 'trending')
                navigate({ view: value, sort: '' })
              else navigate({ view: 'latest', sort: parseBrowseSort(value) })
            }}
          >
            <option value="newest">Latest</option>
            <option value="oldest">Oldest</option>
            <option value="most_tipped">Most tipped</option>
            <option value="featured">Featured</option>
            <option value="trending">Trending</option>
          </select>
        </label>
      </div>
      {author && (
        <details className="writer-filter" open={author ? true : undefined}>
          <summary>
            {author ? `Articles by @${author}` : 'Filter by writer'}
          </summary>
          <label>
            Writer{' '}
            <select
              aria-label="Filter articles by author"
              value={author || ''}
              onChange={(event) => navigate({ author: event.target.value })}
            >
              <option value="">All writers</option>
              {author && !authors?.some((a) => a.username === author) && (
                <option value={author}>@{author}</option>
              )}
              {authors?.map((a) => (
                <option key={a.username} value={a.username}>
                  {a.name || `@${a.username}`}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}
      {message && <p className="browse-context">{message}</p>}
      {!result ? (
        <div className="reading-room-loading" role="status" aria-live="polite">
          <span>Loading articles…</span>
          <div className="skeleton-row" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
      ) : articles.length ? (
        <>
          <section className="shelf" aria-label="Articles">
            {articles.slice(0, visibleCount).map((article, index) => (
              <div className="reading-room-card-entry" key={article.id}>
                <ReadingRoomCard
                  article={article}
                  index={(currentPage - 1) * 9 + index}
                  onNavigate={savePosition}
                  onAuthor={(username) => navigate({ author: username })}
                />
              </div>
            ))}
          </section>
          {articles.length > visibleCount && (
            <button
              className="load-more"
              onClick={() => {
                cancelSearch()
                const next = new URLSearchParams(searchString)
                next.set('count', String(visibleCount + 3))
                router.push(`/articles?${next}`, { scroll: false })
              }}
            >
              Load more
            </button>
          )}
          {totalPages > 1 && visibleCount >= articles.length && (
            <nav className="reading-room-pagination" aria-label="Article pages">
              <button
                disabled={currentPage <= 1}
                onClick={() => navigate({ page: currentPage - 1 })}
              >
                ← Previous
              </button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => navigate({ page: currentPage + 1 })}
              >
                Next articles →
              </button>
            </nav>
          )}
        </>
      ) : (
        <section className="empty">
          <h2>{search ? 'No matching articles.' : 'No articles here yet.'}</h2>
          <p>
            {search
              ? `No articles match “${search}”. Try another search.`
              : 'Try another topic or come back for new writing.'}
          </p>
          <button
            onClick={() => {
              cancelSearch()
              if (search) navigate({ search: '' })
              else router.push('/articles')
            }}
          >
            {search ? 'Try another search' : 'View all articles'}
          </button>
        </section>
      )}
      <footer className="reading-room-footer">
        <span>Read freely. Support the words that stay.</span>
        <details>
          <summary>Public-domain artwork · Credits ↗</summary>
          <p>Artwork appears when an article has no cover image.</p>
          <a
            href="https://www.metmuseum.org/art/collection/search/436535"
            target="_blank"
            rel="noreferrer"
          >
            Wheat Field with Cypresses · Vincent van Gogh
          </a>
          <a
            href="https://www.metmuseum.org/art/collection/search/436121"
            target="_blank"
            rel="noreferrer"
          >
            A Woman Seated beside a Vase of Flowers · Edgar Degas
          </a>
          <a
            href="https://www.metmuseum.org/art/collection/search/436534"
            target="_blank"
            rel="noreferrer"
          >
            Roses · Vincent van Gogh
          </a>
          <a
            href="https://www.metmuseum.org/art/collection/search/435882"
            target="_blank"
            rel="noreferrer"
          >
            Still Life with Apples and a Pot of Primroses · Paul Cézanne
          </a>
        </details>
      </footer>
    </main>
  )
}
