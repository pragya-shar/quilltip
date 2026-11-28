import { cache } from 'react'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import type { FunctionArgs } from 'convex/server'
import { api } from '@/convex/_generated/api'
import { PUBLIC_READ_TIMEOUT_MS } from '@/lib/seo/publicReadTimeout'
import {
  ARTICLE_ROUTE_HEADER,
  parseArticleRoute,
  type ArticleRoute,
} from '@/lib/seo/articleRoute'
import { publicQuery, ReadTimeout } from '@/lib/seo/publicQuery'
import {
  READ_DEADLINE_HEADER,
  pageReadLimitMs,
  parseReadDeadline,
} from '@/lib/seo/readDeadline'
import {
  PROFILE_ARTICLES_PER_PAGE,
  toProfileArticlesPage,
} from '@/lib/profile/profileArticles'

/**
 * Server-side reads for public pages. These run without the visitor's auth token,
 * so they only ever see what an anonymous reader can see: `getArticleBySlug`
 * returns published articles only. `undefined` means the backend could not be
 * reached in time; the page then shows a fallback that reads without scripts,
 * and the client tries again with its live query.
 */
/** Thrown inside the cached read so a missing article is never cached. */
class ArticleMissing extends Error {}

/**
 * How long one of this page's reads may take: what is left of the deadline
 * the proxy stamped (#609), at least 500 ms, at most the read limit. Without
 * a deadline (a request the proxy did not check), the full read limit.
 */
async function pageReadLimit(): Promise<number> {
  return pageReadLimitMs(
    parseReadDeadline((await headers()).get(READ_DEADLINE_HEADER))
  )
}

/**
 * Settles with `read`, or rejects with ReadTimeout after `limitMs`. Used
 * around the cached reads, outside the cache, so a timeout is never stored.
 * Inside the cache each request is aborted at the full read limit, and a
 * rejected read is not cached either.
 */
async function withinLimit<T>(read: Promise<T>, limitMs: number): Promise<T> {
  // A read that loses the race may still reject; nobody is waiting for it.
  read.catch(() => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      read,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ReadTimeout(limitMs)), limitMs)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Seconds a server copy of a published article may be reused. A copy is used
 * only while the article's version matches (see getPublishedArticle), so an
 * edit, an unpublish or a replacement takes effect at once; this limit bounds
 * the data the version does not cover, such as tip totals and the writer's
 * name. The reader page subscribes to the live article on load, so those
 * update in the browser right away.
 */
const PUBLISHED_ARTICLE_REVALIDATE_SECONDS = 60

/**
 * Caches `read` for at most `seconds`. `unstable_cache` alone serves an expired
 * entry while it refreshes in the background, and keeps that entry when the
 * refresh throws (as it does once an article is unpublished). Each entry
 * records when it was read, and an older one is replaced by a direct read, so
 * no copy is ever more than `seconds` old.
 */
function cachedFor<Args extends unknown[], Result>(
  read: (...args: Args) => Promise<Result>,
  key: string,
  seconds: number
) {
  const cached = unstable_cache(
    async (...args: Args) => ({
      value: await read(...args),
      readAt: Date.now(),
    }),
    [key],
    { revalidate: seconds }
  )
  return async (...args: Args): Promise<Result> => {
    const entry = await cached(...args)
    if (Date.now() - entry.readAt <= seconds * 1000) return entry.value
    return read(...args)
  }
}

async function fetchPublishedArticle(
  username: string,
  slug: string,
  limitMs: number
) {
  const article = await publicQuery(limitMs, api.articles.getArticleBySlug, {
    username,
    slug,
  })
  // Not cached: a newly published article must appear immediately.
  if (article === null) throw new ArticleMissing()
  return article
}

/** Keyed by the article's version too, so a changed article is read again. */
const fetchPublishedArticleCached = cachedFor(
  (username: string, slug: string, _version: string) =>
    fetchPublishedArticle(username, slug, PUBLIC_READ_TIMEOUT_MS),
  'published-article-v3',
  PUBLISHED_ARTICLE_REVALIDATE_SECONDS
)

/**
 * Whether the article is published now, and its version. The proxy has asked
 * already on a full page load and passes its answer in a request header;
 * a request the proxy did not check carries none, so the page asks here. A check
 * that runs out of time here rejects, and the page shows its fallback.
 */
async function currentArticleRoute(
  username: string,
  slug: string,
  limitMs: number
): Promise<ArticleRoute | { kind: 'moved' }> {
  const fromProxy = parseArticleRoute(
    (await headers()).get(ARTICLE_ROUTE_HEADER)
  )
  if (fromProxy) return fromProxy
  return publicQuery(limitMs, api.publicRoutes.resolvePublicRoute, {
    username,
    slug,
  })
}

/**
 * Whether the proxy already answered "missing" for this page (#609). It
 * checks moved handles in the same read, so the page then needs no
 * moved-handle lookup of its own and answers not found at once.
 */
export async function proxyAnsweredMissing(): Promise<boolean> {
  return (await headers()).get(ARTICLE_ROUTE_HEADER) === 'missing'
}

export const getPublishedArticle = cache(
  async (username: string, slug: string) => {
    try {
      const limitMs = await pageReadLimit()
      const route = await currentArticleRoute(username, slug, limitMs)
      // Missing or moved; the page checks for a moved handle itself.
      if (route.kind === 'missing' || route.kind === 'moved') return null
      // A cached copy only for the version just confirmed. Otherwise (the
      // proxy's check ran out of time, or the backend has no versions) read
      // directly: a hidden article never comes back from the cache.
      return await (route.kind === 'found' && route.version
        ? withinLimit(
            fetchPublishedArticleCached(username, slug, route.version),
            limitMs
          )
        : fetchPublishedArticle(username, slug, limitMs))
    } catch (error) {
      if (error instanceof ArticleMissing) return null
      console.error('Server article fetch failed', error)
      return undefined
    }
  }
)

export const getPublicProfile = cache(async (username: string) => {
  try {
    return await publicQuery(
      await pageReadLimit(),
      api.users.getUserByUsername,
      { username }
    )
  } catch (error) {
    console.error('Server profile fetch failed', error)
    return undefined
  }
})

/**
 * The first view of a writer's articles for the server-rendered page, or
 * undefined when the backend could not be reached (the client then loads it).
 */
export const getPublicProfileArticles = cache(
  async (username: string, page: number) => {
    try {
      const data = await publicQuery(
        await pageReadLimit(),
        api.articles.listArticles,
        { author: username, page, limit: PROFILE_ARTICLES_PER_PAGE }
      )
      return toProfileArticlesPage(data)
    } catch (error) {
      console.error('Server profile articles fetch failed', error)
      return undefined
    }
  }
)

/**
 * When a writer page is missing, checks whether the handle moved (an earlier
 * handle or different letter case). Returns the new path, null when the
 * handle did not move, or undefined when the lookup failed or ran out of
 * time: the page then shows its readable fallback, never a 404, because an
 * earlier handle must not answer 404 only because the backend was slow (#609).
 */
export async function movedPublicPath(
  username: string,
  slug: string | undefined,
  searchParams: Record<string, string | string[] | undefined>
): Promise<string | null | undefined> {
  try {
    const route = await publicQuery(
      await pageReadLimit(),
      api.publicRoutes.resolvePublicRoute,
      { username, slug }
    )
    if (route.kind !== 'moved') return null
    const base = `/${encodeURIComponent(route.username)}`
    const path =
      slug === undefined ? base : `${base}/${encodeURIComponent(slug)}`
    // Keep the view and page (for example ?tab=nfts&page=2).
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(searchParams)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        if (item !== undefined) query.append(key, item)
      }
    }
    const search = query.toString()
    return search ? `${path}?${search}` : path
  } catch {
    return undefined
  }
}

/**
 * First page of the Reading Room for the server HTML. Search and bookmark
 * lists need the browser (scan protocol, local bookmarks), so they return
 * undefined and load on the client as before.
 */
const fetchReadingRoomCached = cachedFor(
  async (args: FunctionArgs<typeof api.articles.listArticles>) =>
    publicQuery(PUBLIC_READ_TIMEOUT_MS, api.articles.listArticles, args),
  'reading-room-list-v2',
  PUBLISHED_ARTICLE_REVALIDATE_SECONDS
)

export const getReadingRoomList = cache(
  async (args: FunctionArgs<typeof api.articles.listArticles>) => {
    if (args.search || args.bookmarkIds) return undefined
    try {
      return await withinLimit(
        fetchReadingRoomCached(args),
        await pageReadLimit()
      )
    } catch (error) {
      console.error('Server reading room fetch failed', error)
      return undefined
    }
  }
)
