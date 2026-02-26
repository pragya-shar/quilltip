'use client'

import { notFound } from 'next/navigation'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useState, useEffect, useMemo } from 'react'
import ArticleDisplay from '@/components/articles/ArticleDisplay'
import AppNavigation from '@/components/layout/AppNavigation'
import { TipStats } from '@/components/tipping/TipStats'
import { TipButton } from '@/components/tipping/TipButton'
import { NFTIntegration } from '@/components/nft/NFTIntegration'
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
import { Id } from '@/convex/_generated/dataModel'
import { cn } from '@/lib/utils'

interface ArticlePageProps {
  params: Promise<{
    username: string
    slug: string
  }>
}

export default function ArticlePage({ params }: ArticlePageProps) {
  const [routeParams, setRouteParams] = useState<{
    username: string | null
    slug: string | null
  }>({ username: null, slug: null })
  const [showHighlightsPanel, setShowHighlightsPanel] = useState(false)
  const { user } = useAuth()

  // Get params from promise
  useEffect(() => {
    params.then((p) =>
      setRouteParams({
        username: p.username,
        slug: p.slug,
      })
    )
  }, [params])

  // Fetch article
  const article = useQuery(
    api.articles.getArticleBySlug,
    routeParams.username && routeParams.slug
      ? { username: routeParams.username, slug: routeParams.slug }
      : 'skip'
  )

  // Fetch highlights if article exists
  const highlights = useQuery(
    api.highlights.getArticleHighlights,
    article ? { articleId: article._id as Id<'articles'> } : 'skip'
  )

  // Fetch highlight tip stats for tip badges in notes sidebar
  const highlightTipStats = useQuery(
    api.highlightTips.getArticleStats,
    article ? { articleId: article._id as Id<'articles'> } : 'skip'
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

  // Loading state
  if (routeParams.username === null || routeParams.slug === null) {
    return (
      <div className="min-h-screen bg-brand-cream">
        <AppNavigation />
        <main className="pt-20">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="animate-pulse">
              <div className="h-96 bg-gray-200 rounded-lg mb-8"></div>
              <div className="h-8 bg-gray-200 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Check if article exists (null means not found, undefined means loading)
  if (routeParams.username && routeParams.slug && article === null) {
    notFound()
  }

  // Show loading while article is being fetched
  if (!article) {
    return (
      <div className="min-h-screen bg-brand-cream">
        <AppNavigation />
        <main className="pt-20">
          <div className="max-w-4xl mx-auto px-4 py-8">
            <div className="animate-pulse">
              <div className="h-96 bg-gray-200 rounded-lg mb-8"></div>
              <div className="h-8 bg-gray-200 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-8"></div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  // Map Convex article to match ArticleDisplay interface
  const articleForDisplay = {
    id: article._id,
    slug: article.slug,
    title: article.title,
    content: article.content,
    excerpt: article.excerpt,
    coverImage: article.coverImage,
    publishedAt: article.publishedAt ? new Date(article.publishedAt) : null,
    author: article.author,
    // Transform string tags to objects
    tags: (article.tags || []).map((tag: string, index: number) => ({
      id: `tag-${index}`,
      name: tag,
      slug: tag.toLowerCase().replace(/\s+/g, '-'),
    })),
    tipStats: article.tipStats,
  }

  return (
    <div className="min-h-screen bg-brand-cream">
      <AppNavigation />
      <main className="pt-20">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* Main Article Content */}
            <div className="lg:col-span-8">
              <ArticleDisplay article={articleForDisplay} />
            </div>

            {/* Engagement Sidebar */}
            <div className="lg:col-span-4">
              <div className="sticky top-24 space-y-6">
                {/* Tip Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                  <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                    <Heart className="w-5 h-5 text-red-500" />
                    Support the Author
                  </h3>
                  <TipButton
                    articleId={article._id}
                    authorName={article.author.name || article.author.username}
                    authorStellarAddress={article.author.stellarAddress}
                  />
                  <div className="mt-4 pt-4 border-t">
                    <TipStats articleId={article._id} />
                  </div>
                </div>

                {/* NFT Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
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
                    currentUserAddress={user?.stellarAddress}
                  />
                </div>

                {/* Highlight Heatmap Section */}
                <HighlightHeatmap
                  articleId={article._id}
                  isAuthor={user?._id === article.author.id}
                />

                {/* Highlight Notes Section */}
                <div className="bg-white rounded-lg shadow-sm border border-gray-200">
                  <button
                    onClick={() => setShowHighlightsPanel(!showHighlightsPanel)}
                    className="w-full p-6 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <h3 className="text-lg font-semibold flex items-center gap-2">
                      <MessageSquare className="w-5 h-5 text-blue-500" />
                      Highlight Notes
                      {highlights &&
                        highlights.filter((h) => h.note).length > 0 && (
                          <span className="ml-2 px-2 py-0.5 bg-blue-100 text-blue-700 text-sm rounded-full">
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
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                    <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                      <DollarSign className="w-5 h-5 text-green-500" />
                      Article Stats
                    </h3>
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Tips</span>
                        <span className="font-semibold">
                          {article.tipStats.count || 0}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Earned</span>
                        <span className="font-semibold">
                          ${(article.tipStats.total || 0).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Arweave Permanent Storage */}
                {article.arweaveStatus && (
                  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
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
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

// Configure dynamic behavior for production
export const dynamic = 'force-dynamic'
export const dynamicParams = true
