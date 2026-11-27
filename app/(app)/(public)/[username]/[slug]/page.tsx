import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ArticleView } from '@/components/read/ArticleView'
import { loadArticle } from '@/components/read/loadArticle'
import { ReadingUnavailable } from '@/system/components/ReadingUnavailable'
import { retryHrefFor } from '@/shell/public/boundedRead'
import { PushedHeader } from '@/shell/PushedHeader'
import { PushedScreen } from '@/shell/PushedScreen'
import { readNextFor } from '@/components/read/readNext'
import { toReadArticle } from '@/components/read/readModel'
import { getPublishedArticle, movedPublicPath } from '@/lib/seo/publicContent'
import {
  SITE_NAME,
  articleMetaDescription,
  articlePath,
} from '@/lib/seo/siteMetadata'
import { extractPlainTextFromTiptapJson } from '@/lib/tiptap/plainText'
import { renderReadingHtml } from '@/lib/tiptap/renderReadingHtml'

const reads = (
  searchParams: Record<string, string | string[] | undefined>
) => ({
  article: getPublishedArticle,
  moved: (username: string, slug: string) =>
    movedPublicPath(username, slug, searchParams),
})

type ArticlePageProps = {
  params: Promise<{ username: string; slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
  searchParams,
}: ArticlePageProps): Promise<Metadata> {
  const { username, slug } = await params
  const load = await loadArticle(username, slug, reads(await searchParams))
  if (load.kind === 'unreachable')
    return { title: 'Article unavailable', robots: { index: false } }
  if (load.kind !== 'found')
    return { title: 'Page not found', robots: { index: false } }
  const article = load.article

  const authorName = article.author.name || article.author.username
  const description = articleMetaDescription(article)
  const url = articlePath(article.author.username, article.slug)
  const images = article.coverImage ? [{ url: article.coverImage }] : undefined
  return {
    title: article.title,
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

/**
 * An article, rendered on the server and complete without scripts (D19):
 * no loading boundary above it, the full text in the first response. An
 * unknown, draft or private article is a real 404; a writer's earlier
 * handle redirects to the current one. Every read that gates the first
 * byte has a time limit (D21): a backend that does not answer in time gives
 * the unreachable state (200, noindex, no-store), never a 404 and never a
 * blank tab. Worst-case first byte: 3.4 s for an article (the proxy's route
 * check, the article, Read next), 4.5 s for a missing one (the route check,
 * the article, the moved-handle lookup).
 */
export default async function ArticlePage({
  params,
  searchParams,
}: ArticlePageProps) {
  const { username, slug } = await params
  const query = await searchParams
  const load = await loadArticle(username, slug, reads(query))
  // Temporary: writers can switch back to an earlier handle.
  if (load.kind === 'moved') redirect(load.to)
  if (load.kind === 'missing') notFound()
  if (load.kind === 'unreachable')
    return (
      <PushedScreen>
        <div className="qt-page" data-width="read">
          <PushedHeader fallbackHref="/" backLabel="Back to Today" />
          <ReadingUnavailable
            what="This article"
            retryHref={retryHrefFor(`/${username}/${slug}`, query)}
          />
        </div>
      </PushedScreen>
    )
  const article = load.article

  const { html } = renderReadingHtml(article.content)
  const readNext = await readNextFor(article._id)
  return (
    <ArticleView
      article={toReadArticle(article)}
      bodyHtml={html}
      fallbackParagraphs={
        html
          ? undefined
          : [extractPlainTextFromTiptapJson(article.content)].filter(Boolean)
      }
      readNext={readNext}
    />
  )
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true
