import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ArticlePageClient } from '@/components/articles/ArticlePageClient'
import {
  getPublishedArticle,
  movedPublicPath,
  proxyAnsweredMissing,
} from '@/lib/seo/publicContent'
import { renderArticleHtml } from '@/lib/tiptap/renderArticleHtml'
import {
  ReadingUnavailable,
  retryHrefFor,
} from '@/components/articles/ReadingUnavailable'
import {
  SITE_NAME,
  articleMetaDescription,
  articlePath,
} from '@/lib/seo/siteMetadata'

interface ArticlePageProps {
  params: Promise<{
    username: string
    slug: string
  }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { username, slug } = await params
  if (await proxyAnsweredMissing()) return {}
  const article = await getPublishedArticle(username, slug)
  // Missing article (null) or backend unreachable (undefined): site defaults.
  // The page renders the not-found screen; proxy.ts sets the 404 status.
  if (!article) return {}

  const authorName = article.author.name || article.author.username
  const description = articleMetaDescription(article)
  const url = articlePath(article.author.username, article.slug)
  const images = article.coverImage ? [{ url: article.coverImage }] : undefined

  return {
    title: `${article.title} · ${SITE_NAME}`,
    description,
    authors: [{ name: authorName }],
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      siteName: SITE_NAME,
      title: article.title,
      description,
      url,
      images,
      authors: [authorName],
      publishedTime: article.publishedAt
        ? new Date(article.publishedAt).toISOString()
        : undefined,
    },
    twitter: {
      card: images ? 'summary_large_image' : 'summary',
      title: article.title,
      description,
      images: images?.map((image) => image.url),
    },
  }
}

export default async function ArticlePage({
  params,
  searchParams,
}: ArticlePageProps) {
  const { username, slug } = await params
  const query = await searchParams
  const initialArticle = await getPublishedArticle(username, slug)
  if (initialArticle === null) {
    // The proxy's check covers moved handles too: nothing more to ask.
    if (await proxyAnsweredMissing()) notFound()
    const moved = await movedPublicPath(username, slug, query)
    // Temporary: writers can switch back to an earlier handle.
    if (moved) redirect(moved)
    // Not moved: not found. A failed lookup (undefined) shows the readable
    // fallback instead, so an earlier handle never answers 404 only because
    // the backend was slow (#609).
    if (moved === null) notFound()
  }

  return (
    <ArticlePageClient
      username={username}
      slug={slug}
      initialArticle={initialArticle ?? undefined}
      initialBodyHtml={renderArticleHtml(initialArticle?.content)}
      unavailable={
        !initialArticle ? (
          <ReadingUnavailable
            what="article"
            headingLevel={1}
            retryHref={retryHrefFor(
              `/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
              query
            )}
          />
        ) : undefined
      }
    />
  )
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true
