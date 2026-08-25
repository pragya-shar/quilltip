'use client'

import Link from 'next/link'
import { PenSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Doc } from '@/types/convex'

type PrimaryWritingDraft = Pick<Doc<'articles'>, '_id' | 'title'>

type PrimaryWritingActionProps = {
  mostRecentDraft: PrimaryWritingDraft | null
}

export function PrimaryWritingAction({
  mostRecentDraft,
}: PrimaryWritingActionProps) {
  if (mostRecentDraft) {
    const draftTitle = mostRecentDraft.title?.trim() || 'Untitled'
    return (
      <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] shadow-[var(--card-shadow)]">
        <p className="mb-3 text-sm text-muted-foreground">
          Pick up where you left off
        </p>
        <Button
          asChild
          className="h-auto w-full flex-col items-start gap-1 bg-brand px-5 py-4 text-left text-brand-foreground hover:bg-brand-hover"
        >
          <Link href={`/write?id=${mostRecentDraft._id}`}>
            <span className="flex items-center gap-2 text-base font-semibold">
              <PenSquare className="h-5 w-5 shrink-0" />
              Continue writing
            </span>
            <span className="line-clamp-1 text-sm font-normal opacity-90">
              {draftTitle}
            </span>
          </Link>
        </Button>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            href="/write"
            className="text-brand-blue hover:text-brand-accent font-medium"
          >
            Start a new article
          </Link>
          <Link
            href="/drafts"
            className="text-muted-foreground hover:text-foreground"
          >
            View all drafts
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-[var(--card-radius)] border border-border bg-card p-[var(--card-padding)] shadow-[var(--card-shadow)]">
      <p className="mb-3 text-sm text-muted-foreground">
        Your writing workspace is ready
      </p>
      <Button
        asChild
        className="h-auto w-full gap-2 bg-brand px-5 py-4 text-base font-semibold text-brand-foreground hover:bg-brand-hover"
      >
        <Link href="/write">
          <PenSquare className="h-5 w-5" />
          Start a new article
        </Link>
      </Button>
    </div>
  )
}
