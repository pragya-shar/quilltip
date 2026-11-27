import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { ArticleView } from '@/components/read/ArticleView'
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

type ArticlePageProps = {
  params: Promise<{ username: string; slug: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({
  params,
}: ArticlePageProps): Promise<Metadata> {
  const { username, slug } = await params
  const article = await getPublishedArticle(username, slug)
  // Missing (null) or unreachable (undefined): the page answers for itself.
  if (!article) return { title: 'Page not found', robots: { index: false } }

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
 * handle redirects to the current one.
 */
export default async function ArticlePage({
  params,
  searchParams,
}: ArticlePageProps) {
  const { username, slug } = await params
  const article = await getPublishedArticle(username, slug)
  if (article === null) {
    const moved = await movedPublicPath(username, slug, await searchParams)
    // Temporary: writers can switch back to an earlier handle.
    if (moved) redirect(moved)
    notFound()
  }
  // The backend could not answer: the shell's error page, with a retry.
  if (article === undefined) throw new Error('The article could not load.')

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
