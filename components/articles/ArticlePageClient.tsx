'use client'

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArticleReadNext } from '@/components/articles/ArticleReadNext'
import { lazy, Suspense, useMemo } from 'react'
import type { FunctionReturnType } from 'convex/server'
import type { api } from '@/convex/_generated/api'
import {
  useArticleBySlug,
  useReadNextArticles,
  useArticleHighlightTipStatsOptional,
  useArticleHighlightsQuery,
} from '@/hooks/convex'
import ArticleDisplay from '@/components/articles/ArticleDisplay'
import { ArticlePageLoadingSkeleton } from '@/components/articles/ArticlePageLoadingSkeleton'
import { ArticleReaderSupport } from '@/components/articles/ArticleReaderSupport'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { useAuth } from '@/components/providers/AuthContext'
import type { Id } from '@/types/convex'
import type { ArticleForDisplay } from '@/types/index'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import {
  ArticleDisplaySectionFallback,
  ArticleSidebarSectionFallback,
} from '@/components/error/SectionErrorFallback'
import { ReadingProgressBar } from '@/components/articles/ReadingProgressBar'
import { EditorialSurface } from '@/components/layout/EditorialSurface'
import { extractH2HeadingsFromTiptapJson } from '@/lib/tiptap/headings'
import { LoadingRegion } from '@/components/a11y/LoadingRegion'
import { useStaleLoading } from '@/hooks/useStaleLoading'
import { useRouter } from 'next/navigation'

// The collapsed details panel sits below the article. The server renders it
// into the HTML; its accordion, highlight notes and date code load while the
// page hydrates instead of with the first scripts.
const ArticleDetailsPanel = lazy(() =>
  import('@/components/articles/ArticleDetailsPanel').then((mod) => ({
    default: mod.ArticleDetailsPanel,
  }))
)

type PublishedArticle = FunctionReturnType<typeof api.articles.getArticleBySlug>

interface ArticlePageClientProps {
  username: string
  slug: string
  /** Server-fetched published article, so the first HTML has its content. */
  initialArticle?: PublishedArticle
  /** Server-rendered HTML of `initialArticle`'s body. */
  initialBodyHtml?: string
}

export function ArticlePageClient({
  username,
  slug,
  initialArticle,
  initialBodyHtml,
}: ArticlePageClientProps) {
  const { user } = useAuth()
  const router = useRouter()

  const liveArticle = useArticleBySlug(username, slug)
  // Until the live query answers, render the server copy (published only).
  const article =
    liveArticle === undefined ? (initialArticle ?? undefined) : liveArticle
  const nextArticles = useReadNextArticles(article?._id)
  const { isStale, reset: resetStale } = useStaleLoading(article === undefined)

  const highlights = useArticleHighlightsQuery(article?._id)

  const highlightTipStats = useArticleHighlightTipStatsOptional(article?._id)

  const tocHeadings = useMemo(
    () => extractH2HeadingsFromTiptapJson(article?.content),
    [article?.content]
  )

  const tipsByHighlight = useMemo(() => {
    if (!highlightTipStats?.topHighlights) return {}
    return Object.fromEntries(
      highlightTipStats.topHighlights.map((h) => [
        h.highlightId,
        { count: h.tipCount, totalUsd: h.totalAmountCents / 100 },
      ])
    )
  }, [highlightTipStats])

  if (article === null) {
    notFound()
  }

  if (article === undefined) {
    return (
      <div className="min-h-screen reader-surface">
        <AppNavigation />
        <LoadingRegion
          label="article"
          isLoading
          isStale={isStale}
          onRetry={() => {
            resetStale()
            router.refresh()
          }}
          fallback={<ArticlePageLoadingSkeleton />}
        >
          <div />
        </LoadingRegion>
      </div>
    )
  }

  const articleForDisplay: ArticleForDisplay = {
    id: article._id,
    slug: article.slug,
    title: article.title,
    content: article.content,
    excerpt: article.excerpt,
    coverImage: article.coverImage,
    publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
    author: {
      id: article.author.id,
      name: article.author.name ?? null,
      username: article.author.username,
      avatar: article.author.avatar ?? null,
      bio: undefined,
    },
    tags: (article.tags || []).map((tag: string, index: number) => ({
      id: `tag-${index}`,
      name: tag,
      slug: tag.toLowerCase().replace(/\s+/g, '-'),
    })),
    tipStats: article.tipStats,
  }

  return (
    <div className="flex min-h-screen flex-col reader-surface">
      <AppNavigation />
      <ReadingProgressBar articleId={article._id} />
      <main className="flex-1 pt-20 w-full">
        <EditorialSurface className="reader-layout">
          <Link href="/articles" className="reader-return">
            ← Articles
          </Link>
          <ErrorBoundary
            fallback={({ reset }) => (
              <ArticleDisplaySectionFallback onRetry={reset} />
            )}
          >
            <ArticleDisplay
              article={articleForDisplay}
              tocHeadings={tocHeadings}
              // The server HTML matches the article it was rendered from; the
              // highlight editor takes over with live content once loaded.
              bodyHtml={
                initialArticle && article._id === initialArticle._id
                  ? initialBodyHtml
                  : undefined
              }
              authorStellarAddress={article.author.stellarAddress}
              readNext={
                <ArticleReadNext
                  currentArticleId={article._id}
                  articles={nextArticles ?? []}
                />
              }
              readerSupport={
                <ArticleReaderSupport
                  articleTitle={article.title}
                  articleId={article._id}
                  articleSlug={article.slug}
                  authorName={article.author.name || article.author.username}
                />
              }
            />
          </ErrorBoundary>

          <ErrorBoundary
            fallback={({ reset }) => (
              <ArticleSidebarSectionFallback onRetry={reset} />
            )}
          >
            <Suspense fallback={null}>
              <ArticleDetailsPanel
                articleId={article._id}
                articleTitle={article.title}
                articleExcerpt={article.excerpt}
                articleSlug={article.slug}
                authorId={article.author.id}
                currentUserId={user?._id as Id<'users'> | undefined}
                tocHeadings={tocHeadings}
                highlights={highlights}
                tipsByHighlight={tipsByHighlight}
                tipStats={article.tipStats}
                arweaveStatus={article.arweaveStatus}
                arweaveTxId={article.arweaveTxId}
                arweaveUrl={article.arweaveUrl}
                arweaveTimestamp={article.arweaveTimestamp}
              />
            </Suspense>
          </ErrorBoundary>
        </EditorialSurface>
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}
