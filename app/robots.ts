import type { MetadataRoute } from 'next'
import { SITE_ORIGIN } from '@/lib/seo/siteMetadata'
import { PRIVATE_PATH_PREFIXES } from '@/lib/seo/sitemapEntries'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...PRIVATE_PATH_PREFIXES] },
    sitemap: `${SITE_ORIGIN}/sitemap.xml`,
  }
}
