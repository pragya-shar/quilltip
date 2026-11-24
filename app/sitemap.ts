import type { MetadataRoute } from 'next'
import { fetchQuery } from 'convex/nextjs'
import type { FunctionReturnType } from 'convex/server'
import { api } from '@/convex/_generated/api'
import { buildSitemap, type SitemapArticle } from '@/lib/seo/sitemapEntries'

// Built per request so new articles appear without a redeploy.
export const dynamic = 'force-dynamic'

type SitemapPage = FunctionReturnType<typeof api.articles.listSitemapEntries>

const PAGE_SIZE = 100
// Well under the 50,000-URL limit for a single sitemap file.
const MAX_PAGES = 200

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    const articles: SitemapArticle[] = []
    let cursor: string | null = null
    for (let i = 0; i < MAX_PAGES; i++) {
      const result: SitemapPage = await fetchQuery(
        api.articles.listSitemapEntries,
        {
          paginationOpts: { numItems: PAGE_SIZE, cursor },
        }
      )
      articles.push(...result.page)
      if (result.isDone) break
      cursor = result.continueCursor
    }
    return buildSitemap(articles)
  } catch (error) {
    // Backend unreachable: still serve the static public pages.
    console.error('Sitemap data fetch failed', error)
    return buildSitemap(null)
  }
}
