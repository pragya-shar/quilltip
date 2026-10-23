'use client'

import { Id } from '@/convex/_generated/dataModel'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, Coins, Lock, ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { UserAvatar } from '@/components/ui/user-avatar'

interface HighlightData {
  _id: Id<'highlights'>
  highlightId?: string
  text: string
  color?: string
  note?: string
  isPublic: boolean
  userId: Id<'users'>
  userName?: string
  userAvatar?: string
  createdAt: number
}

interface HighlightNotesProps {
  highlights: HighlightData[]
  currentUserId?: Id<'users'>
  onNoteClick?: (highlight: HighlightData) => void
  className?: string
  tipsByHighlight?: Record<string, { count: number; totalUsd: number }>
}

export function HighlightNotes({
  highlights,
  currentUserId,
  onNoteClick,
  className,
  tipsByHighlight,
}: HighlightNotesProps) {
  // Filter only highlights with notes
  const highlightsWithNotes = highlights.filter(
    (h) => h.note && h.note.trim().length > 0
  )

  if (highlightsWithNotes.length === 0) {
    return (
      <div className={cn('highlight-empty', className)}>
        <MessageSquare aria-hidden />
        <p className="font-semibold text-ui-foreground mb-1">No notes yet</p>
        <p>Keep a passage and add a note. Your thoughts will appear here.</p>
      </div>
    )
  }

  return (
    <div className={cn('highlight-notes', className)}>
      {highlightsWithNotes.map((highlight) => {
        const tipData = highlight.highlightId
          ? tipsByHighlight?.[highlight.highlightId]
          : undefined
        return (
          <button
            type="button"
            key={highlight._id}
            className="highlight-note-item"
            onClick={() => onNoteClick?.(highlight)}
            aria-label={`Go to passage: ${highlight.text}`}
          >
            <span className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="flex min-w-0 items-center gap-2">
                <UserAvatar
                  src={highlight.userAvatar}
                  alt={highlight.userName || 'User'}
                  name={highlight.userName || 'Anonymous'}
                  className="h-6 w-6 shrink-0"
                  fallbackClassName="text-xs"
                />
                <span className="min-w-0 font-semibold text-ui-foreground">
                  {highlight.userName || 'Anonymous'}
                  {highlight.userId === currentUserId && ' (You)'}
                </span>
              </span>
              <span className="text-ui-muted-foreground">
                {formatDistanceToNow(new Date(highlight.createdAt), {
                  addSuffix: true,
                })}
              </span>
            </span>
            <span
              className="highlight-text-preview block line-clamp-2"
              style={{ borderLeftColor: highlight.color || '#F59E0B' }}
            >
              &ldquo;{highlight.text}&rdquo;
            </span>
            <span className="block whitespace-pre-wrap text-sm leading-relaxed text-ui-foreground">
              {highlight.note}
            </span>
            <span className="mt-3 flex flex-wrap items-center gap-3 text-xs text-ui-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {!highlight.isPublic && (
                  <Lock className="h-3 w-3" aria-hidden />
                )}
                {highlight.isPublic ? 'Public note' : 'Private · Only you'}
              </span>
              {tipData && tipData.count > 0 && (
                <span className="inline-flex items-center gap-1 text-ui-primary">
                  <Coins className="h-3 w-3" aria-hidden />
                  {tipData.count} tip{tipData.count > 1 ? 's' : ''}
                  {' · '}${tipData.totalUsd.toFixed(2)}
                </span>
              )}
              <span className="ml-auto inline-flex items-center gap-1 text-ui-primary">
                View passage <ArrowUpRight className="h-3 w-3" aria-hidden />
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
