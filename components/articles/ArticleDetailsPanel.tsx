'use client'

import nextDynamic from 'next/dynamic'
import { earningsLabel } from '@/lib/copy/network-status'
import { useEffect, useState } from 'react'
import ShareButtons from './ShareButtons'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ArticleTableOfContents } from '@/components/articles/ArticleTableOfContents'
import { HighlightHeatmap } from '@/components/highlights/HighlightHeatmap'
import { HighlightNotes } from '@/components/highlights/HighlightNotes'
import { ArticleStorageSection } from '@/components/articles/ArticleStorageSection'
import { NftSidebarSkeleton } from '@/components/articles/ArticleEngagementSkeleton'
import { DollarSign, MessageSquare, Trophy } from 'lucide-react'
import type { Id } from '@/types/convex'
import type { TocHeading } from '@/lib/articles/toc'
import type { Doc } from '@/convex/_generated/dataModel'
import { DetailsSection } from '@/components/articles/DetailsSection'

const NFTIntegration = nextDynamic(
  () =>
    import('@/components/nft/NFTIntegration').then((mod) => ({
      default: mod.NFTIntegration,
    })),
  { ssr: false, loading: () => <NftSidebarSkeleton /> }
)

interface ArticleDetailsPanelProps {
  articleId: Id<'articles'>
  articleTitle: string
  articleExcerpt?: string | null
  articleSlug: string
  authorId: Id<'users'>
  currentUserId?: Id<'users'>
  tocHeadings: TocHeading[]
  highlights: Doc<'highlights'>[] | undefined
  tipsByHighlight: Record<string, { count: number; totalUsd: number }>
  tipStats?: { count?: number; total?: number } | null
  arweaveStatus?: string | null
  arweaveTxId?: string | null
  arweaveUrl?: string | null
  arweaveTimestamp?: number | null
}

export function ArticleDetailsPanel({
  articleId,
  articleTitle,
  articleExcerpt,
  articleSlug,
  authorId,
  currentUserId,
  tocHeadings,
  highlights,
  tipsByHighlight,
  tipStats,
  arweaveStatus,
  arweaveTxId,
  arweaveUrl,
  arweaveTimestamp,
}: ArticleDetailsPanelProps) {
  const [currentUrl, setCurrentUrl] = useState('')
  useEffect(() => {
    setCurrentUrl(window.location.href)
  }, [articleId])
  const showToc = tocHeadings.length >= 3
  const noteCount = highlights?.filter((h) => h.note?.trim()).length ?? 0

  return (
    <Accordion type="single" collapsible className="reader-details">
      <AccordionItem value="article-details" className="border-none">
        <AccordionTrigger className="reader-details-trigger">
          Article details
        </AccordionTrigger>
        <AccordionContent className="reader-details-content">
          <div className="reader-details-sections">
            {currentUrl && (
              <DetailsSection>
                <ShareButtons
                  title={articleTitle}
                  excerpt={articleExcerpt}
                  url={currentUrl}
                />
              </DetailsSection>
            )}
            {showToc && (
              <DetailsSection>
                <ArticleTableOfContents headings={tocHeadings} embedded />
              </DetailsSection>
            )}

            <DetailsSection>
              <h4 className="reader-section-title">
                <Trophy className="w-4 h-4 text-muted-foreground" />
                NFT Collection
              </h4>
              <NFTIntegration
                articleId={articleId}
                articleTitle={articleTitle}
                articleSlug={articleSlug}
                authorId={authorId}
                currentUserId={currentUserId}
                embedded
              />
            </DetailsSection>

            <DetailsSection>
              <HighlightHeatmap
                articleId={articleId}
                isAuthor={currentUserId === authorId}
                embedded
              />
            </DetailsSection>

            <DetailsSection>
              <h4 className="reader-section-title">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Highlight Notes
                {noteCount > 0 && (
                  <span className="px-2 py-0.5 border border-ui-border text-ui-primary text-xs rounded-[var(--ui-radius)]">
                    {noteCount}
                  </span>
                )}
              </h4>
              <HighlightNotes
                highlights={highlights || []}
                currentUserId={currentUserId}
                tipsByHighlight={tipsByHighlight}
                onNoteClick={(highlight) => {
                  const element = document.querySelector(
                    `[data-highlight-id="${highlight._id}"]`
                  )
                  element?.scrollIntoView({
                    behavior: matchMedia('(prefers-reduced-motion: reduce)')
                      .matches
                      ? 'instant'
                      : 'smooth',
                    block: 'center',
                  })
                }}
                className="max-h-[500px] overflow-y-auto"
              />
            </DetailsSection>

            {tipStats && (
              <DetailsSection>
                <h4 className="reader-section-title">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  Article Stats
                </h4>
                <div className="reader-stats">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Tips</span>
                    <span className="font-semibold">{tipStats.count || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">
                      {earningsLabel('Total earned')}
                    </span>
                    <span className="font-semibold">
                      ${(tipStats.total || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </DetailsSection>
            )}

            <ArticleStorageSection
              status={arweaveStatus}
              txId={arweaveTxId}
              url={arweaveUrl}
              timestamp={arweaveTimestamp}
            />
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
