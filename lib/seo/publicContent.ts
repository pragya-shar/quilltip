import { cache } from 'react'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import {
  PROFILE_ARTICLES_PER_PAGE,
  toProfileArticlesPage,
} from '@/lib/profile/profileArticles'

/**
 * Server-side reads for public pages. These run without the visitor's auth token,
 * so they only ever see what an anonymous reader can see: `getArticleBySlug`
 * returns published articles only. `undefined` means the backend could not be
 * reached; the page then falls back to loading on the client.
 */
export const getPublishedArticle = cache(
  async (username: string, slug: string) => {
    try {
      return await fetchQuery(api.articles.getArticleBySlug, { username, slug })
    } catch (error) {
      console.error('Server article fetch failed', error)
      return undefined
    }
  }
)

export const getPublicProfile = cache(async (username: string) => {
  try {
    return await fetchQuery(api.users.getUserByUsername, { username })
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
      const data = await fetchQuery(api.articles.listArticles, {
        author: username,
        page,
        limit: PROFILE_ARTICLES_PER_PAGE,
      })
      return toProfileArticlesPage(data)
    } catch (error) {
      console.error('Server profile articles fetch failed', error)
      return undefined
    }
  }
)

/**
 * When a writer page is missing, checks whether the handle moved (an earlier
 * handle or different letter case). Returns the new path, or null.
 */
export async function movedPublicPath(
  username: string,
  slug: string | undefined,
  searchParams: Record<string, string | string[] | undefined>
): Promise<string | null> {
  try {
    const route = await fetchQuery(api.publicRoutes.resolvePublicRoute, {
      username,
      slug,
    })
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
    return null
  }
}
