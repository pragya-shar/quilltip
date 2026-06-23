'use client'

import nextDynamic from 'next/dynamic'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { ArticleTableOfContents } from '@/components/articles/ArticleTableOfContents'
import { HighlightHeatmap } from '@/components/highlights/HighlightHeatmap'
import { HighlightNotes } from '@/components/highlights/HighlightNotes'
import { ArweaveStatus } from '@/components/articles/ArweaveStatus'
import { NftSidebarSkeleton } from '@/components/articles/ArticleEngagementSkeleton'
import { Archive, DollarSign, MessageSquare, Trophy } from 'lucide-react'
import type { Id } from '@/types/convex'
import type { TocHeading } from '@/lib/tiptap/headings'
import type { Doc } from '@/convex/_generated/dataModel'

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

function DetailsSection({ children }: { children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6 first:border-t-0 first:pt-0">
      {children}
    </section>
  )
}

export function ArticleDetailsPanel({
  articleId,
  articleTitle,
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
  const showToc = tocHeadings.length >= 3
  const noteCount = highlights?.filter((h) => h.note).length ?? 0

  return (
    <Accordion
      type="single"
      collapsible
      className="mt-8 border-t border-border"
    >
      <AccordionItem value="article-details" className="border-none">
        <AccordionTrigger className="text-muted-foreground hover:text-foreground hover:no-underline">
          Article details
        </AccordionTrigger>
        <AccordionContent>
          <div className="space-y-0">
            {showToc && (
              <DetailsSection>
                <ArticleTableOfContents headings={tocHeadings} embedded />
              </DetailsSection>
            )}

            <DetailsSection>
              <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
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
              <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                Highlight Notes
                {noteCount > 0 && (
                  <span className="px-2 py-0.5 bg-primary/15 text-primary text-xs rounded-full">
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
                    behavior: 'smooth',
                    block: 'center',
                  })
                }}
                className="max-h-[500px] overflow-y-auto"
              />
            </DetailsSection>

            {tipStats && (
              <DetailsSection>
                <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
                  <DollarSign className="w-4 h-4 text-muted-foreground" />
                  Article Stats
                </h4>
                <div className="space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Tips</span>
                    <span className="font-semibold">{tipStats.count || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Total Earned</span>
                    <span className="font-semibold">
                      ${(tipStats.total || 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </DetailsSection>
            )}

            {arweaveStatus && (
              <DetailsSection>
                <h4 className="text-sm font-medium flex items-center gap-2 mb-4">
                  <Archive className="w-4 h-4 text-muted-foreground" />
                  Permanent Storage
                </h4>
                <ArweaveStatus
                  status={arweaveStatus}
                  txId={arweaveTxId ?? undefined}
                  url={arweaveUrl ?? undefined}
                  timestamp={arweaveTimestamp ?? undefined}
                />
              </DetailsSection>
            )}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}
