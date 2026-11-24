import type { MetadataRoute } from 'next'
import { SITE_ORIGIN, articlePath, profilePath } from '@/lib/seo/siteMetadata'

/** Public pages that do not come from the database. */
export const STATIC_SITEMAP_PATHS = [
  '/',
  '/articles',
  '/wallet/practice',
  '/support',
  '/contact',
  '/privacy',
  '/terms',
] as const

/** Signed-in or personal areas that search engines should not crawl. */
export const PRIVATE_PATH_PREFIXES = [
  '/dashboard',
  '/settings',
  '/write',
  '/drafts',
  '/library',
  '/profile',
  '/demo',
] as const

type SitemapData = {
  articles: { username: string; slug: string; lastModified: number }[]
  writers: { username: string; lastModified: number }[]
}

export function buildSitemap(data: SitemapData | null): MetadataRoute.Sitemap {
  const staticEntries = STATIC_SITEMAP_PATHS.map((path) => ({
    url: `${SITE_ORIGIN}${path === '/' ? '' : path}`,
  }))
  if (!data) return staticEntries

  return [
    ...staticEntries,
    ...data.writers.map((writer) => ({
      url: `${SITE_ORIGIN}${profilePath(writer.username)}`,
      lastModified: new Date(writer.lastModified),
    })),
    ...data.articles.map((article) => ({
      url: `${SITE_ORIGIN}${articlePath(article.username, article.slug)}`,
      lastModified: new Date(article.lastModified),
    })),
  ]
}
