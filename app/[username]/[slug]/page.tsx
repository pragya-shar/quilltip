'use client'

import { notFound } from 'next/navigation'
import { use, useMemo } from 'react'
import {
  useArticleBySlug,
  useArticleHighlightTipStatsOptional,
  useArticleHighlightsQuery,
} from '@/hooks/convex'
import ArticleDisplay from '@/components/articles/ArticleDisplay'
import { ArticlePageLoadingSkeleton } from '@/components/articles/ArticlePageLoadingSkeleton'
import { ArticleReaderSupport } from '@/components/articles/ArticleReaderSupport'
import { ArticleDetailsPanel } from '@/components/articles/ArticleDetailsPanel'
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

interface ArticlePageProps {
  params: Promise<{
    username: string
    slug: string
  }>
}

export default function ArticlePage({ params }: ArticlePageProps) {
  const { username, slug } = use(params)
  const { user } = useAuth()
  const router = useRouter()

  const article = useArticleBySlug(username, slug)
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
      <div className="min-h-screen bg-background">
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
    <div className="flex min-h-screen flex-col bg-background">
      <AppNavigation />
      <ReadingProgressBar />
      <main className="flex-1 pt-20 w-full">
        <EditorialSurface>
          <ErrorBoundary fallback={<ArticleDisplaySectionFallback />}>
            <ArticleDisplay
              article={articleForDisplay}
              tocHeadings={tocHeadings}
              authorStellarAddress={article.author.stellarAddress}
              readerSupport={
                <ArticleReaderSupport
                  articleId={article._id}
                  articleSlug={article.slug}
                  authorName={article.author.name || article.author.username}
                  authorStellarAddress={article.author.stellarAddress}
                />
              }
            />
          </ErrorBoundary>

          <ErrorBoundary fallback={<ArticleSidebarSectionFallback />}>
            <ArticleDetailsPanel
              articleId={article._id}
              articleTitle={article.title}
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
          </ErrorBoundary>
        </EditorialSurface>
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}

export const dynamic = 'force-dynamic'
export const dynamicParams = true
