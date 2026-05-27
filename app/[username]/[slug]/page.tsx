'use client'

import nextDynamic from 'next/dynamic'
import { notFound } from 'next/navigation'
import { use, useState, useMemo } from 'react'
import { ArticleTipActions } from '@/components/tipping/ArticleTipActions'
import {
  useArticleBySlug,
  useArticleHighlightTipStatsOptional,
  useArticleHighlightsQuery,
} from '@/hooks/convex'
import ArticleDisplay from '@/components/articles/ArticleDisplay'
import { ArticlePageLoadingSkeleton } from '@/components/articles/ArticlePageLoadingSkeleton'
import AppNavigation from '@/components/layout/AppNavigation'
import { SiteFooter } from '@/components/layout/SiteFooter'
import { TipStats } from '@/components/tipping/TipStats'
import { NftSidebarSkeleton } from '@/components/articles/ArticleEngagementSkeleton'

const NFTIntegration = nextDynamic(
  () =>
    import('@/components/nft/NFTIntegration').then((mod) => ({
      default: mod.NFTIntegration,
    })),
  { ssr: false, loading: () => <NftSidebarSkeleton /> }
)
import {
  DollarSign,
  Trophy,
  Heart,
  MessageSquare,
  ChevronDown,
  Archive,
} from 'lucide-react'
import { ArweaveStatus } from '@/components/articles/ArweaveStatus'
import { HighlightNotes } from '@/components/highlights/HighlightNotes'
import { HighlightHeatmap } from '@/components/highlights/HighlightHeatmap'
import { useAuth } from '@/components/providers/AuthContext'
import type { Id } from '@/types/convex'
import type { ArticleForDisplay } from '@/types/index'
import { cn } from '@/lib/utils'
import { ErrorBoundary } from '@/components/error/ErrorBoundary'
import {
  ArticleDisplaySectionFallback,
  ArticleSidebarSectionFallback,
} from '@/components/error/SectionErrorFallback'
import { ReadingProgressBar } from '@/components/articles/ReadingProgressBar'
import { extractH2HeadingsFromTiptapJson } from '@/lib/tiptap/headings'
import { ArticleTableOfContents } from '@/components/articles/ArticleTableOfContents'

interface ArticlePageProps {
  params: Promise<{
    username: string
    slug: string
  }>
}

export default function ArticlePage({ params }: ArticlePageProps) {
  const { username, slug } = use(params)
  const [showHighlightsPanel, setShowHighlightsPanel] = useState(false)
  const { user } = useAuth()

  const article = useArticleBySlug(username, slug)

  const highlights = useArticleHighlightsQuery(article?._id)

  const highlightTipStats = useArticleHighlightTipStatsOptional(article?._id)

  const tocHeadings = useMemo(
    () => extractH2HeadingsFromTiptapJson(article?.content),
    [article?.content]
  )

  // Build lookup map for tip badges
  const tipsByHighlight = useMemo(() => {
    if (!highlightTipStats?.topHighlights) return {}
    return Object.fromEntries(
      highlightTipStats.topHighlights.map((h) => [
        h.highlightId,
        { count: h.tipCount, totalUsd: h.totalAmountCents / 100 },
      ])
    )
  }, [highlightTipStats])

  // Check if article exists (null means not found, undefined means loading)
  if (article === null) {
    notFound()
  }

  // Show loading while article is being fetched
  if (!article) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavigation />
        <ArticlePageLoadingSkeleton />
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
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Main Article Content */}
            <div className="lg:col-span-8">
              <ErrorBoundary fallback={<ArticleDisplaySectionFallback />}>
                <ArticleDisplay
                  article={articleForDisplay}
                  tocHeadings={tocHeadings}
                  authorStellarAddress={article.author.stellarAddress}
                />
              </ErrorBoundary>
            </div>

            {/* Engagement Sidebar */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              <ErrorBoundary fallback={<ArticleSidebarSectionFallback />}>
                {tocHeadings.length >= 3 && (
                  <div className="sticky top-24 z-10 w-full self-start bg-background lg:max-h-[calc(100dvh-7rem)] lg:overflow-y-auto">
                    <ArticleTableOfContents headings={tocHeadings} />
                  </div>
                )}
                <div className="space-y-6">
                  {/* Tip Section */}
                  <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-[var(--card-padding)]">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Heart className="w-5 h-5 text-red-500" />
                      Support the Author
                    </h3>
                    <ArticleTipActions
                      articleId={article._id}
                      articleSlug={article.slug}
                      authorName={
                        article.author.name || article.author.username
                      }
                      authorStellarAddress={article.author.stellarAddress}
                    />
                    <div className="mt-4 pt-4 border-t">
                      <TipStats articleId={article._id} />
                    </div>
                  </div>

                  {/* NFT Section */}
                  <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-[var(--card-padding)]">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <Trophy className="w-5 h-5 text-purple-500" />
                      NFT Collection
                    </h3>
                    <NFTIntegration
                      articleId={article._id}
                      articleTitle={article.title}
                      articleSlug={article.slug}
                      authorId={article.author.id}
                      currentUserId={user?._id as Id<'users'> | undefined}
                    />
                  </div>

                  {/* Highlight Heatmap Section */}
                  <HighlightHeatmap
                    articleId={article._id}
                    isAuthor={user?._id === article.author.id}
                  />

                  {/* Highlight Notes Section */}
                  <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border">
                    <button
                      onClick={() =>
                        setShowHighlightsPanel(!showHighlightsPanel)
                      }
                      className="w-full p-[var(--card-padding)] flex items-center justify-between hover:bg-muted transition-colors"
                    >
                      <h3 className="text-lg font-semibold flex items-center gap-2">
                        <MessageSquare className="w-5 h-5 text-blue-500" />
                        Highlight Notes
                        {highlights &&
                          highlights.filter((h) => h.note).length > 0 && (
                            <span className="ml-2 px-2 py-0.5 bg-primary/15 text-primary text-sm rounded-full">
                              {highlights.filter((h) => h.note).length}
                            </span>
                          )}
                      </h3>
                      <ChevronDown
                        className={cn(
                          'w-4 h-4 transform transition-transform',
                          showHighlightsPanel ? 'rotate-180' : ''
                        )}
                      />
                    </button>

                    {showHighlightsPanel && (
                      <div className="border-t">
                        <HighlightNotes
                          highlights={highlights || []}
                          currentUserId={user?._id as Id<'users'> | undefined}
                          tipsByHighlight={tipsByHighlight}
                          onNoteClick={(highlight) => {
                            // Scroll to highlight in article
                            const element = document.querySelector(
                              `[data-highlight-id="${highlight._id}"]`
                            )
                            element?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'center',
                            })
                          }}
                          className="max-h-[500px] overflow-y-auto"
                        />
                      </div>
                    )}
                  </div>

                  {/* Article Stats */}
                  {article.tipStats && (
                    <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-[var(--card-padding)]">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <DollarSign className="w-5 h-5 text-green-500" />
                        Article Stats
                      </h3>
                      <div className="space-y-3">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Total Tips
                          </span>
                          <span className="font-semibold">
                            {article.tipStats.count || 0}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">
                            Total Earned
                          </span>
                          <span className="font-semibold">
                            ${(article.tipStats.total || 0).toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Arweave Permanent Storage */}
                  {article.arweaveStatus && (
                    <div className="bg-card rounded-[var(--card-radius)] shadow-[var(--card-shadow)] border border-border p-[var(--card-padding)]">
                      <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                        <Archive className="w-5 h-5 text-blue-500" />
                        Permanent Storage
                      </h3>
                      <ArweaveStatus
                        status={article.arweaveStatus}
                        txId={article.arweaveTxId}
                        url={article.arweaveUrl}
                        timestamp={article.arweaveTimestamp}
                      />
                    </div>
                  )}
                </div>
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </main>
      <SiteFooter variant="default" />
    </div>
  )
}

// Configure dynamic behavior for production
export const dynamic = 'force-dynamic'
export const dynamicParams = true
