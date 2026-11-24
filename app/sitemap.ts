import type { MetadataRoute } from 'next'
import { fetchQuery } from 'convex/nextjs'
import { api } from '@/convex/_generated/api'
import { buildSitemap } from '@/lib/seo/sitemapEntries'

// Built per request so new articles appear without a redeploy.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  try {
    return buildSitemap(await fetchQuery(api.articles.listSitemapEntries, {}))
  } catch (error) {
    // Backend unreachable: still serve the static public pages.
    console.error('Sitemap data fetch failed', error)
    return buildSitemap(null)
  }
}
