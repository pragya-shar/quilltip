'use client'

import { Id } from '@/convex/_generated/dataModel'
import { formatDistanceToNow } from 'date-fns'
import { MessageSquare, Coins } from 'lucide-react'
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
      <div className={cn('p-6 text-center', className)}>
        <MessageSquare className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
        <p className="text-muted-foreground text-sm">
          No notes yet. Highlight text and add a note to see it here.
        </p>
      </div>
    )
  }

  return (
    <div className={cn('divide-y divide-border', className)}>
      {highlightsWithNotes.map((highlight) => (
        <div
          key={highlight._id}
          role="button"
          tabIndex={0}
          className="p-4 hover:bg-muted/50 transition-colors cursor-pointer"
          onClick={() => onNoteClick?.(highlight)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onNoteClick?.(highlight)
            }
          }}
        >
          {/* Note header */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex items-center gap-2">
              <UserAvatar
                src={highlight.userAvatar}
                alt={highlight.userName || 'User'}
                name={highlight.userName || 'Anonymous'}
                className="h-6 w-6"
                fallbackClassName="text-xs"
              />
              <span className="text-sm font-medium text-foreground">
                {highlight.userName || 'Anonymous'}
              </span>
              {highlight.userId === currentUserId && (
                <span className="text-xs text-muted-foreground">(You)</span>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(highlight.createdAt), {
                addSuffix: true,
              })}
            </span>
          </div>

          {/* Highlighted text snippet */}
          <div
            className="mb-2 px-2 py-1 rounded text-sm text-foreground line-clamp-2"
            style={{
              backgroundColor: `${highlight.color || '#FFEB3B'}40`,
              borderLeft: `3px solid ${highlight.color || '#FFEB3B'}`,
            }}
          >
            &ldquo;{highlight.text}&rdquo;
          </div>

          {/* Tip badge */}
          {(() => {
            const tipData = highlight.highlightId
              ? tipsByHighlight?.[highlight.highlightId]
              : undefined
            if (!tipData?.count) return null
            return (
              <div className="mb-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-muted text-muted-foreground text-xs rounded-full">
                  <Coins className="w-3 h-3" />
                  {tipData.count} tip{tipData.count > 1 ? 's' : ''}
                  {' · '}${tipData.totalUsd.toFixed(2)}
                </span>
              </div>
            )
          })()}

          {/* Note content */}
          <div className="text-sm text-muted-foreground italic">
            {highlight.note}
          </div>

          {/* Visibility indicator */}
          {!highlight.isPublic && (
            <div className="mt-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                Private
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
