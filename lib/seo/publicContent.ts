import { cache } from 'react'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'

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
 * When a writer page is missing, checks whether the handle moved (an earlier
 * handle or different letter case). Returns the new path, or null.
 */
export async function movedPublicPath(
  username: string,
  slug?: string
): Promise<string | null> {
  try {
    const route = await fetchQuery(api.publicRoutes.resolvePublicRoute, {
      username,
      slug,
    })
    if (route.kind !== 'moved') return null
    const base = `/${encodeURIComponent(route.username)}`
    return slug === undefined ? base : `${base}/${encodeURIComponent(slug)}`
  } catch {
    return null
  }
}
