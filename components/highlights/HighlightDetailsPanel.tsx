'use client'

import { useState, useMemo, useRef, useEffect } from 'react'
import { useMutation } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useHighlightTipsByHighlight } from '@/hooks/convex'
import type { Id } from '@/types/convex'
import { motion } from 'motion/react'
import { FocusScope } from '@radix-ui/react-focus-scope'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  X,
  Coins,
  User,
  Calendar,
  MessageSquare,
  Edit,
  Trash2,
  Loader2,
  TrendingUp,
} from 'lucide-react'
import { HighlightTipButton } from './HighlightTipButton'
import { formatTipAmount } from '@/lib/stellar/highlight-utils'
import { UserAvatar } from '@/components/ui/user-avatar'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useClampedFixedPosition } from '@/hooks/useClampedFixedPosition'

interface HighlightDetailsPanelProps {
  highlight: {
    _id: Id<'highlights'>
    text: string
    startOffset: number
    endOffset: number
    startContainerPath: string
    endContainerPath: string
    highlightId: string
    color?: string
    note?: string
    isPublic: boolean
    userId: Id<'users'>
    userName?: string
    userAvatar?: string
    createdAt: number
  }
  position: { top: number; left: number }
  onClose: () => void
  onDeleted?: (highlightId: Id<'highlights'>) => void
  currentUserId?: Id<'users'>
  // Article data for tipping
  articleId?: Id<'articles'>
  articleSlug?: string
  authorName?: string
  authorStellarAddress?: string | null
}

export function HighlightDetailsPanel({
  highlight,
  position,
  onClose,
  onDeleted,
  currentUserId,
  articleId,
  articleSlug,
  authorName,
  authorStellarAddress,
}: HighlightDetailsPanelProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editedNote, setEditedNote] = useState(highlight.note || '')
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const clampedPosition = useClampedFixedPosition(position, panelRef, {
    fallbackWidth: 448,
    fallbackHeight: 400,
  })

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (deleteConfirmOpen) return
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [deleteConfirmOpen, onClose])

  // Check if current user owns this highlight
  const isOwner = currentUserId && currentUserId === highlight.userId

  // Fetch tip statistics for this highlight
  const highlightTips = useHighlightTipsByHighlight(highlight.highlightId)

  // Mutations
  const updateHighlight = useMutation(api.highlights.updateHighlight)
  const deleteHighlight = useMutation(api.highlights.deleteHighlight)

  // Calculate tip stats
  const tipStats = useMemo(() => {
    if (!highlightTips) return { count: 0, totalCents: 0, totalUsd: 0 }

    const totalCents = highlightTips.reduce(
      (sum, tip) => sum + tip.amountCents,
      0
    )

    return {
      count: highlightTips.length,
      totalCents,
      totalUsd: totalCents / 100,
    }
  }, [highlightTips])

  // Handle note update
  const handleSaveNote = async () => {
    try {
      await updateHighlight({
        id: highlight._id,
        note: editedNote || undefined,
      })
      setIsEditing(false)
      toast.success('Note updated successfully')
    } catch (error) {
      console.error('Failed to update note:', error)
      toast.error('Failed to update note')
    }
  }

  const handleConfirmDelete = async () => {
    if (isDeleting) return
    setIsDeleting(true)
    try {
      await deleteHighlight({ id: highlight._id })
      toast.success('Highlight deleted')
      setDeleteConfirmOpen(false)
      onDeleted?.(highlight._id)
      onClose()
    } catch (error) {
      console.error('Failed to delete highlight:', error)
      toast.error('Failed to delete highlight')
      setIsDeleting(false)
    }
  }

  // Truncate text for display
  const displayText =
    highlight.text.length > 150
      ? highlight.text.slice(0, 150) + '...'
      : highlight.text
  const confirmSnippet =
    highlight.text.trim().length > 90
      ? `${highlight.text.trim().slice(0, 90)}…`
      : highlight.text.trim()

  return (
    <motion.div
      ref={panelRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      transition={{ duration: 0.2 }}
      className="fixed z-50 bg-popover text-popover-foreground rounded-xl shadow-2xl border border-border w-full max-w-[min(28rem,calc(100vw-24px))] outline-none"
      style={{
        top: clampedPosition.top,
        left: clampedPosition.left,
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Highlight details"
      tabIndex={-1}
    >
      <FocusScope
        trapped={!deleteConfirmOpen}
        loop
        onMountAutoFocus={(e) => {
          e.preventDefault()
          closeButtonRef.current?.focus()
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-border">
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-foreground mb-1">
              Highlight Details
            </h3>
            <div
              className="text-xs px-2 py-1 rounded inline-block"
              style={{
                backgroundColor: `${highlight.color}33`,
                color: highlight.color || '#F59E0B',
              }}
            >
              {highlight.isPublic ? 'Public' : 'Private'}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close highlight details"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Highlighted Text */}
        <div className="p-4 border-b border-border">
          <div
            className="p-3 rounded-lg border-l-4 italic text-sm text-foreground"
            style={{ borderLeftColor: highlight.color || '#F59E0B' }}
          >
            &ldquo;{displayText}&rdquo;
          </div>
        </div>

        {/* Creator Info */}
        <div className="px-4 py-3 border-b border-border">
          <div className="flex items-center gap-3">
            <UserAvatar
              src={highlight.userAvatar}
              alt={highlight.userName || 'User'}
              name={highlight.userName || 'Anonymous'}
              className="h-8 w-8"
            />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <User className="w-3 h-3 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  {highlight.userName || 'Anonymous'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <Calendar className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {new Date(highlight.createdAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Note Section */}
        {(highlight.note || isOwner) && (
          <div className="px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">
                Note
              </span>
            </div>

            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editedNote}
                  onChange={(e) => setEditedNote(e.target.value)}
                  placeholder="Add a note to your highlight..."
                  className="w-full px-3 py-2 text-sm border border-input bg-background text-foreground rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent resize-none"
                  rows={3}
                  // eslint-disable-next-line jsx-a11y/no-autofocus
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveNote}
                    className="flex-1 px-3 py-1.5 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditedNote(highlight.note || '')
                      setIsEditing(false)
                    }}
                    className="flex-1 px-3 py-1.5 bg-muted text-foreground text-sm rounded-lg hover:bg-muted/80 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-foreground">
                {highlight.note || (
                  <span className="text-muted-foreground italic">
                    No note added
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Tip Statistics */}
        {tipStats.count > 0 && (
          <div className="px-4 py-3 border-b border-border bg-gradient-to-r from-yellow-50 to-orange-50 dark:from-yellow-950/30 dark:to-orange-950/30">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-orange-500" />
              <span className="text-xs font-medium text-foreground">
                Tip Statistics
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-muted-foreground">Total Tips</div>
                <div className="text-lg font-bold text-foreground">
                  {tipStats.count}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  Total Earned
                </div>
                <div className="text-lg font-bold text-orange-600">
                  {formatTipAmount(tipStats.totalCents)}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="p-4">
          {isOwner ? (
            // Owner actions: Edit & Delete
            <div className="space-y-2">
              {!isEditing && (
                <>
                  <button
                    onClick={() => setIsEditing(true)}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-950/50 transition-colors text-sm font-medium"
                  >
                    <Edit className="w-4 h-4" />
                    <span>Edit Note</span>
                  </button>
                  <button
                    onClick={() => setDeleteConfirmOpen(true)}
                    disabled={isDeleting}
                    className={cn(
                      'w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg transition-colors text-sm font-medium',
                      isDeleting
                        ? 'bg-muted text-muted-foreground cursor-not-allowed'
                        : 'bg-red-50 dark:bg-red-950/30 text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-950/50'
                    )}
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Deleting...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-4 h-4" />
                        <span>Delete Highlight</span>
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          ) : (
            // Non-owner action: Tip
            articleId &&
            articleSlug &&
            authorStellarAddress && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                  <Coins className="w-3 h-3" />
                  <span>Support this insight</span>
                </div>
                <HighlightTipButton
                  articleId={articleId}
                  articleSlug={articleSlug}
                  authorName={authorName || 'Author'}
                  authorStellarAddress={authorStellarAddress}
                  highlightText={highlight.text}
                  startOffset={highlight.startOffset}
                  endOffset={highlight.endOffset}
                  startContainerPath={highlight.startContainerPath}
                  endContainerPath={highlight.endContainerPath}
                  className="w-full justify-center"
                  onSuccess={() => {
                    toast.success('Tip sent! Statistics will update shortly')
                    // Panel stays open to show updated stats
                  }}
                />
                {tipStats.count === 0 && (
                  <p className="text-xs text-center text-muted-foreground mt-2">
                    Be the first to tip this highlight!
                  </p>
                )}
              </div>
            )
          )}
        </div>

        {/* Footer hint */}
        {!isOwner && tipStats.count > 0 && (
          <div className="px-4 pb-3 text-xs text-center text-muted-foreground">
            {tipStats.count}{' '}
            {tipStats.count === 1 ? 'person has' : 'people have'} tipped this
            highlight
          </div>
        )}
      </FocusScope>

      <AlertDialog
        open={deleteConfirmOpen}
        onOpenChange={(open) => {
          if (isDeleting) return
          setDeleteConfirmOpen(open)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this highlight?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  This will permanently delete the highlight and its note. This
                  action cannot be undone.
                </p>
                {confirmSnippet.length > 0 ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground">
                    <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Highlight
                    </div>
                    <p className="mt-1 italic">
                      &ldquo;{confirmSnippet}&rdquo;
                    </p>
                  </div>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={(e) => {
                e.preventDefault()
                void handleConfirmDelete()
              }}
            >
              {isDeleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete highlight'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
}
