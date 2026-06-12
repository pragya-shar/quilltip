'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import type { Doc, Id } from '@/types/convex'
import {
  formatWordCount,
  getWordCountFromContent,
} from '@/lib/drafts/draftMetadata'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

type DraftListRowProps = {
  draft: Doc<'articles'>
  onDelete: (id: Id<'articles'>) => void
  isDeleting: boolean
}

export function DraftListRow({
  draft,
  onDelete,
  isDeleting,
}: DraftListRowProps) {
  const title = draft.title?.trim() || 'Untitled'
  const editedLabel = formatDistanceToNow(new Date(draft.updatedAt), {
    addSuffix: true,
  })
  const wordCount = getWordCountFromContent(draft.content)

  return (
    <div className="group relative rounded-[var(--card-radius)] border border-border bg-card shadow-[var(--card-shadow)] transition-shadow hover:shadow-md">
      <Link
        href={`/write?id=${draft._id}`}
        className="focus-ring block rounded-[var(--card-radius)] px-[var(--card-padding)] py-4 pr-14"
      >
        <h2 className="text-lg font-semibold text-foreground group-hover:text-brand-blue line-clamp-1 break-words">
          {title}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span
            className={cn(
              'inline-flex rounded-md px-2 py-0.5 text-xs font-medium',
              'bg-warning/10 text-warning-foreground'
            )}
          >
            Draft
          </span>
          <span aria-hidden="true">·</span>
          <span>Edited {editedLabel}</span>
          <span aria-hidden="true">·</span>
          <span>{formatWordCount(wordCount)}</span>
        </div>
        {draft.excerpt && (
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
            {draft.excerpt}
          </p>
        )}
      </Link>

      <div className="absolute top-4 right-[var(--card-padding)]">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label={`Actions for ${title}`}
              onClick={(event) => event.stopPropagation()}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            <DropdownMenuItem
              className="cursor-pointer gap-2 text-destructive focus:text-destructive disabled:opacity-50 disabled:pointer-events-none"
              disabled={isDeleting}
              onSelect={() => {
                if (isDeleting) return
                onDelete(draft._id)
              }}
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
