import type { MetadataRoute } from 'next'
import { SITE_ORIGIN, articlePath, profilePath } from '@/lib/seo/siteMetadata'

/** Public pages that do not come from the database. */
export const STATIC_SITEMAP_PATHS = [
  '/',
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

export type SitemapArticle = {
  username: string
  slug: string
  lastModified: number
}

/** Exact path and its children, without also matching longer names. */
export function privateRobotsRules(prefixes: readonly string[]) {
  return prefixes.flatMap((prefix) => [`${prefix}$`, `${prefix}/`])
}

export function buildSitemap(
  articles: SitemapArticle[] | null
): MetadataRoute.Sitemap {
  const staticEntries = STATIC_SITEMAP_PATHS.map((path) => ({
    url: `${SITE_ORIGIN}${path === '/' ? '' : path}`,
  }))
  if (!articles) return staticEntries

  const writers = new Map<string, number>()
  for (const article of articles) {
    writers.set(
      article.username,
      Math.max(writers.get(article.username) ?? 0, article.lastModified)
    )
  }

  return [
    ...staticEntries,
    ...[...writers].map(([username, lastModified]) => ({
      url: `${SITE_ORIGIN}${profilePath(username)}`,
      lastModified: new Date(lastModified),
    })),
    ...articles.map((article) => ({
      url: `${SITE_ORIGIN}${articlePath(article.username, article.slug)}`,
      lastModified: new Date(article.lastModified),
    })),
  ]
}
